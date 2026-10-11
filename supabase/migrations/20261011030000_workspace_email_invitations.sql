create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) <= 254),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  delivered_at timestamptz,
  accepted_at timestamptz,
  canceled_at timestamptz
);
create index workspace_invitations_sender on public.workspace_invitations(invited_by);
create index workspace_invitations_workspace on public.workspace_invitations(workspace_id);
alter table public.workspace_invitations enable row level security;
revoke all on public.workspace_invitations from anon, authenticated;
grant all on public.workspace_invitations to service_role;

create function public.create_workspace_invitation(target_workspace_id uuid, target_role_id uuid, invited_email text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare normalized_email text := lower(btrim(invited_email)); invitation_id uuid; caller_is_owner boolean;
begin
  perform private.require_role_access(target_workspace_id, 'roles.members.add');
  -- All workspaces share one sender lock so concurrent requests cannot exceed the global cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  perform 1 from public.workspaces where id = target_workspace_id for update;
  perform private.require_role_access(target_workspace_id, 'roles.members.add');
  if normalized_email is null or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  select r.is_system and r.key = 'workspace.owner' into caller_is_owner
    from public.workspace_users u join public.roles r on r.id = u.role_id
    where u.workspace_id = target_workspace_id and u.user_id = auth.uid();
  perform 1 from public.roles r where r.id = target_role_id and (r.is_system or r.workspace_id = target_workspace_id)
    and (caller_is_owner or not (r.is_system and r.key = 'workspace.owner')) for share;
  if not found then
    raise exception 'You cannot invite users to this role' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspace_users u join auth.users a on a.id = u.user_id
    where u.workspace_id = target_workspace_id and lower(a.email) = normalized_email) then
    raise exception 'This email already belongs to a workspace member' using errcode = '23505';
  end if;
  if exists (select 1 from public.workspace_invitations i where i.workspace_id = target_workspace_id
    and i.email = normalized_email and i.accepted_at is null and i.canceled_at is null and i.expires_at > now()) then
    raise exception 'There is already a pending invitation for this email in this workspace' using errcode = '23505';
  end if;
  if (select count(*) from public.workspace_invitations i where i.invited_by = auth.uid()
    and i.accepted_at is null and i.canceled_at is null and i.expires_at > now()) >= 10 then
    raise exception 'You have 10 pending invitations. Wait for acceptance or remove an invitation before inviting more users.'
      using errcode = '23514';
  end if;
  insert into public.workspace_invitations(workspace_id, role_id, invited_by, email)
    values (target_workspace_id, target_role_id, auth.uid(), normalized_email) returning id into invitation_id;
  return invitation_id;
end;
$$;

create function public.list_my_workspace_invitations()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view invitations' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc) from (
    select i.id, i.workspace_id, w.name as workspace_name, i.email, r.name as role_name,
      i.created_at, i.expires_at, i.delivered_at
    from public.workspace_invitations i join public.workspaces w on w.id = i.workspace_id
      join public.roles r on r.id = i.role_id
    where i.invited_by = auth.uid() and i.accepted_at is null and i.canceled_at is null and i.expires_at > now()
  ) page), '[]'::jsonb);
end;
$$;

create function public.cancel_workspace_invitation(invitation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to remove invitations' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  update public.workspace_invitations set canceled_at = now()
    where id = invitation_id and invited_by = auth.uid() and accepted_at is null and canceled_at is null;
  if not found then raise exception 'This invitation is no longer pending or is not yours' using errcode = 'P0002'; end if;
end;
$$;

create function public.accept_workspace_invitation(invitation_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare invitation public.workspace_invitations; recipient_email text; caller_is_owner boolean;
begin
  select lower(email) into recipient_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if recipient_email is null then raise exception 'Sign in with the confirmed invited email to accept' using errcode = '42501'; end if;
  select * into invitation from public.workspace_invitations where id = invitation_id;
  if not found or invitation.email <> recipient_email then
    raise exception 'Invitation is unavailable for this account' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(invitation.invited_by::text, 0));
  perform 1 from public.workspaces where id = invitation.workspace_id for update;
  select * into invitation from public.workspace_invitations where id = invitation_id for update;
  if not found or invitation.canceled_at is not null or invitation.expires_at <= now() or invitation.delivered_at is null then
    raise exception 'This invitation has expired, was removed, or has not been delivered' using errcode = 'P0002';
  end if;
  if invitation.accepted_at is not null then
    if exists (select 1 from public.workspace_users where workspace_id = invitation.workspace_id and user_id = auth.uid()) then
      return invitation.workspace_id;
    end if;
    raise exception 'This invitation has already been used' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.workspace_users u
    join public.role_permissions rp on rp.role_id = u.role_id
    join public.permissions p on p.id = rp.permission_id
    where u.workspace_id = invitation.workspace_id and u.user_id = invitation.invited_by and p.key = 'roles.members.add') then
    raise exception 'The sender can no longer invite users to this workspace' using errcode = '42501';
  end if;
  select r.is_system and r.key = 'workspace.owner' into caller_is_owner
    from public.workspace_users u join public.roles r on r.id = u.role_id
    where u.workspace_id = invitation.workspace_id and u.user_id = invitation.invited_by;
  perform 1 from public.roles r where r.id = invitation.role_id
    and (r.is_system or r.workspace_id = invitation.workspace_id)
    and (caller_is_owner or not (r.is_system and r.key = 'workspace.owner')) for share;
  if not found then raise exception 'The invitation role is no longer available' using errcode = '42501'; end if;
  -- Acceptance never overwrites an existing membership, including a concurrently assigned Owner.
  insert into public.workspace_users(workspace_id, user_id, role_id)
    values (invitation.workspace_id, auth.uid(), invitation.role_id) on conflict do nothing;
  update public.workspace_invitations set accepted_at = now() where id = invitation_id;
  return invitation.workspace_id;
end;
$$;

create function public.get_workspace_invitation(invitation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  select jsonb_build_object('workspace_name', w.name, 'role_name', r.name, 'email', i.email)
    into result from public.workspace_invitations i
    join public.workspaces w on w.id = i.workspace_id join public.roles r on r.id = i.role_id
    join auth.users a on a.id = auth.uid() and lower(a.email) = i.email and a.email_confirmed_at is not null
    where i.id = invitation_id and i.canceled_at is null and i.expires_at > now() and i.delivered_at is not null;
  if result is null then
    raise exception 'Invitation is unavailable. It may have expired or been removed, or you may be signed in with a different email.'
      using errcode = '42501';
  end if;
  return result;
end;
$$;

create function public.list_workspace_users(target_workspace_id uuid, search_term text default '', after_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  return jsonb_build_object(
    'total', (select count(*) from public.workspace_users where workspace_id = target_workspace_id),
    'members', coalesce((select jsonb_agg(to_jsonb(page) order by page.user_id) from (
      select u.user_id, u.role_id, r.name as role_name, coalesce(a.email, '') as email,
        coalesce(nullif(a.raw_user_meta_data->>'full_name', ''), a.email, 'Workspace member') as name
      from public.workspace_users u join auth.users a on a.id = u.user_id join public.roles r on r.id = u.role_id
      where u.workspace_id = target_workspace_id and (after_user_id is null or u.user_id > after_user_id)
        and (coalesce(search_term, '') = '' or strpos(lower(coalesce(a.email, '')), lower(search_term)) > 0
          or strpos(lower(coalesce(a.raw_user_meta_data->>'full_name', '')), lower(search_term)) > 0)
      order by u.user_id limit 11
    ) page), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_workspace_invitation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.list_my_workspace_invitations() from public, anon, authenticated;
revoke all on function public.cancel_workspace_invitation(uuid) from public, anon, authenticated;
revoke all on function public.accept_workspace_invitation(uuid) from public, anon, authenticated;
revoke all on function public.list_workspace_users(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_workspace_invitation(uuid, uuid, text) to authenticated;
grant execute on function public.list_my_workspace_invitations() to authenticated;
grant execute on function public.cancel_workspace_invitation(uuid) to authenticated;
grant execute on function public.accept_workspace_invitation(uuid) to authenticated;
grant execute on function public.list_workspace_users(uuid, text, uuid) to authenticated;
revoke all on function public.get_workspace_invitation(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_invitation(uuid) to authenticated;
