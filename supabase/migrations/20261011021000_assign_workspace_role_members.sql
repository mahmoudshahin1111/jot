insert into public.permissions (key, name, description)
values ('roles.members.add', 'Assign workspace members', 'Assign existing workspace users to a role, replacing their current role.')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.is_system and r.key = 'workspace.owner' and p.key = 'roles.members.add'
on conflict do nothing;

create function public.list_workspace_role_candidates(
  target_workspace_id uuid, target_role_id uuid, page_size integer default 10,
  after_user_id uuid default null, search_term text default ''
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare caller_is_owner boolean; target_is_owner boolean; owner_count bigint;
begin
  perform private.require_role_access(target_workspace_id, 'roles.members.add');
  if page_size is null or page_size < 1 or page_size > 100 then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  select is_system and key = 'workspace.owner' into target_is_owner
    from public.roles where id = target_role_id and (is_system or workspace_id = target_workspace_id);
  if not found then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  select r.is_system and r.key = 'workspace.owner' into caller_is_owner
    from public.workspace_users u join public.roles r on r.id = u.role_id
    where u.workspace_id = target_workspace_id and u.user_id = auth.uid();
  if target_is_owner and not caller_is_owner then
    raise exception 'Only workspace owners can assign the Owner role' using errcode = '42501';
  end if;
  select count(*) into owner_count from public.workspace_users u join public.roles r on r.id = u.role_id
    where u.workspace_id = target_workspace_id and r.is_system and r.key = 'workspace.owner';
  return coalesce((select jsonb_agg(to_jsonb(page) order by page.user_id) from (
    select u.user_id, u.role_id, r.name as role_name, coalesce(a.email, '') as email,
      coalesce(nullif(a.raw_user_meta_data->>'full_name', ''), nullif(a.email, ''), 'Workspace member') as name
    from public.workspace_users u join auth.users a on a.id = u.user_id join public.roles r on r.id = u.role_id
    where u.workspace_id = target_workspace_id and u.role_id <> target_role_id
      and (after_user_id is null or u.user_id > after_user_id)
      and (caller_is_owner or (u.user_id <> auth.uid() and not (r.is_system and r.key = 'workspace.owner')))
      and (not (r.is_system and r.key = 'workspace.owner') or owner_count > 1)
      and (coalesce(search_term, '') = ''
        or strpos(lower(coalesce(a.email, '')), lower(search_term)) > 0
        or strpos(lower(coalesce(a.raw_user_meta_data->>'full_name', '')), lower(search_term)) > 0)
    order by u.user_id limit page_size + 1
  ) page), '[]'::jsonb);
end;
$$;

create function public.assign_workspace_role_member(
  target_workspace_id uuid, target_role_id uuid, target_user_id uuid, expected_role_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare caller_is_owner boolean; target_is_owner boolean; old_role_id uuid; old_is_owner boolean;
begin
  perform private.require_role_access(target_workspace_id, 'roles.members.add');
  -- Serialize with member removal to preserve the last owner during concurrent changes.
  perform 1 from public.workspaces where id = target_workspace_id for update;
  perform private.require_role_access(target_workspace_id, 'roles.members.add');
  select is_system and key = 'workspace.owner' into target_is_owner
    from public.roles where id = target_role_id and (is_system or workspace_id = target_workspace_id) for share;
  if not found then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  select r.is_system and r.key = 'workspace.owner' into caller_is_owner
    from public.workspace_users u join public.roles r on r.id = u.role_id
    where u.workspace_id = target_workspace_id and u.user_id = auth.uid() for share of u;
  select u.role_id, r.is_system and r.key = 'workspace.owner' into old_role_id, old_is_owner
    from public.workspace_users u join public.roles r on r.id = u.role_id
    where u.workspace_id = target_workspace_id and u.user_id = target_user_id for update of u;
  if not found then
    raise exception 'This user is no longer in the workspace' using errcode = 'P0002';
  end if;
  if not caller_is_owner and (target_user_id = auth.uid() or target_is_owner or old_is_owner) then
    raise exception 'Only workspace owners can change their own role or manage owners' using errcode = '42501';
  end if;
  if expected_role_id is null or old_role_id <> expected_role_id or old_role_id = target_role_id then
    raise exception 'This user changed roles. Reload the users before assigning them.' using errcode = '40001';
  end if;
  if old_is_owner and not target_is_owner and (select count(*)
    from public.workspace_users u join public.roles r on r.id = u.role_id
    where u.workspace_id = target_workspace_id and r.is_system and r.key = 'workspace.owner') <= 1 then
    raise exception 'The last workspace owner cannot be reassigned' using errcode = '23514';
  end if;
  update public.workspace_users set role_id = target_role_id
    where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

revoke all on function public.list_workspace_role_candidates(uuid, uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.assign_workspace_role_member(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_workspace_role_candidates(uuid, uuid, integer, uuid, text) to authenticated;
grant execute on function public.assign_workspace_role_member(uuid, uuid, uuid, uuid) to authenticated;
