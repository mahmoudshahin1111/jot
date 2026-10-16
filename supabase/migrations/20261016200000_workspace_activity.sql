insert into public.permissions (key, name, description)
values ('activity.read', 'View workspace activity', 'View the workspace activity history.')
on conflict (key) do update
set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system and r.key = 'workspace.owner' and p.key = 'activity.read'
on conflict (role_id, permission_id) do nothing;

create table public.workspace_activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  description text not null check (length(trim(description)) > 0),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  affected_item_type text check (affected_item_type in ('role', 'task')),
  affected_item_id uuid,
  affected_item_name text,
  details jsonb not null default '{}'::jsonb
);

create index workspace_activity_events_page_idx
  on public.workspace_activity_events (workspace_id, created_at desc, id desc);

alter table public.workspace_activity_events enable row level security;
revoke all on public.workspace_activity_events from public, anon, authenticated;

create function private.record_workspace_activity(
  target_workspace_id uuid,
  target_event_type text,
  target_description text,
  target_item_type text,
  target_item_id uuid,
  target_item_name text,
  target_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_user_id uuid := auth.uid();
  acting_user_name text;
begin
  if acting_user_id is null or target_workspace_id is null then
    return;
  end if;

  select coalesce(
    nullif(a.raw_user_meta_data->>'full_name', ''),
    nullif(a.email, ''),
    'Workspace member'
  )
  into acting_user_name
  from auth.users a
  where a.id = acting_user_id;

  insert into public.workspace_activity_events (
    workspace_id, event_type, description, actor_user_id, actor_name,
    affected_item_type, affected_item_id, affected_item_name, details
  )
  values (
    target_workspace_id,
    target_event_type,
    target_description,
    acting_user_id,
    coalesce(acting_user_name, 'Workspace member'),
    target_item_type,
    target_item_id,
    target_item_name,
    coalesce(target_details, '{}'::jsonb)
  );
end;
$$;

create function private.log_workspace_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  member_name text;
  previous_role_name text;
  changed_fields text[] := array[]::text[];
  event_description text;
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'workspaces' then
    perform private.record_workspace_activity(
      new.id, 'workspace.created', pg_catalog.format('Created workspace "%s".', new.name),
      null, null, null, '{}'::jsonb
    );
    return new;
  elsif tg_table_name = 'tasks' then
    if tg_op = 'INSERT' then
      perform private.record_workspace_activity(
        new.workspace_id, 'task.created', pg_catalog.format('Created task "%s".', new.title),
        'task', new.id, new.title, '{}'::jsonb
      );
      return new;
    elsif tg_op = 'UPDATE' then
      if new.title is distinct from old.title then changed_fields := pg_catalog.array_append(changed_fields, 'title'); end if;
      if new.description is distinct from old.description then changed_fields := pg_catalog.array_append(changed_fields, 'description'); end if;
      if new.status is distinct from old.status then changed_fields := pg_catalog.array_append(changed_fields, 'status'); end if;
      if pg_catalog.cardinality(changed_fields) = 0 then return new; end if;
      perform private.record_workspace_activity(
        new.workspace_id, 'task.updated',
        pg_catalog.format('Updated task "%s" (%s).', new.title, pg_catalog.array_to_string(changed_fields, ', ')),
        'task', new.id, new.title, pg_catalog.jsonb_build_object('changed_fields', changed_fields)
      );
      return new;
    else
      perform private.record_workspace_activity(
        old.workspace_id, 'task.deleted', pg_catalog.format('Deleted task "%s".', old.title),
        'task', old.id, old.title, '{}'::jsonb
      );
      return old;
    end if;
  elsif tg_table_name = 'roles' then
    if tg_op = 'INSERT' then
      if new.workspace_id is not null then
        perform private.record_workspace_activity(
          new.workspace_id, 'role.created', pg_catalog.format('Created role "%s".', new.name),
          'role', new.id, new.name, '{}'::jsonb
        );
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      if old.workspace_id is not null and (new.name is distinct from old.name or new.key is distinct from old.key) then
        perform private.record_workspace_activity(
          new.workspace_id, 'role.updated', pg_catalog.format('Updated role "%s".', new.name),
          'role', new.id, new.name, pg_catalog.jsonb_build_object('previous_name', old.name)
        );
      end if;
      return new;
    else
      if old.workspace_id is not null then
        perform private.record_workspace_activity(
          old.workspace_id, 'role.deleted', pg_catalog.format('Deleted role "%s".', old.name),
          'role', old.id, old.name, '{}'::jsonb
        );
      end if;
      return old;
    end if;
  elsif tg_table_name = 'workspace_users' then
    if tg_op = 'INSERT' then
      select r.name into role_name from public.roles r where r.id = new.role_id;
      select coalesce(nullif(a.raw_user_meta_data->>'full_name', ''), nullif(a.email, ''), 'Workspace member')
        into member_name from auth.users a where a.id = new.user_id;
      event_description := case
        when new.user_id = auth.uid() then pg_catalog.format('Joined the workspace as role "%s".', role_name)
        else pg_catalog.format('Added %s as role "%s".', coalesce(member_name, 'a member'), role_name)
      end;
      perform private.record_workspace_activity(
        new.workspace_id, 'member.added', event_description, 'role', new.role_id, role_name,
        pg_catalog.jsonb_build_object('member_id', new.user_id, 'member_name', coalesce(member_name, 'Workspace member'))
      );
      return new;
    elsif tg_op = 'UPDATE' then
      if new.role_id is not distinct from old.role_id then return new; end if;
      select r.name into role_name from public.roles r where r.id = new.role_id;
      select r.name into previous_role_name from public.roles r where r.id = old.role_id;
      select coalesce(nullif(a.raw_user_meta_data->>'full_name', ''), nullif(a.email, ''), 'Workspace member')
        into member_name from auth.users a where a.id = new.user_id;
      perform private.record_workspace_activity(
        new.workspace_id, 'member.role_changed',
        pg_catalog.format('Changed %s to role "%s".', coalesce(member_name, 'a member'), role_name),
        'role', new.role_id, role_name,
        pg_catalog.jsonb_build_object(
          'member_id', new.user_id, 'member_name', coalesce(member_name, 'Workspace member'),
          'previous_role_id', old.role_id, 'previous_role_name', previous_role_name
        )
      );
      return new;
    else
      select r.name into role_name from public.roles r where r.id = old.role_id;
      select coalesce(nullif(a.raw_user_meta_data->>'full_name', ''), nullif(a.email, ''), 'Workspace member')
        into member_name from auth.users a where a.id = old.user_id;
      perform private.record_workspace_activity(
        old.workspace_id, 'member.removed',
        pg_catalog.format('Removed %s from the workspace.', coalesce(member_name, 'a member')),
        'role', old.role_id, role_name,
        pg_catalog.jsonb_build_object('member_id', old.user_id, 'member_name', coalesce(member_name, 'Workspace member'))
      );
      return old;
    end if;
  elsif tg_table_name = 'workspace_invitations' then
    if tg_op = 'INSERT' then
      select r.name into role_name from public.roles r where r.id = new.role_id;
      perform private.record_workspace_activity(
        new.workspace_id, 'invitation.created',
        pg_catalog.format('Invited %s to role "%s".', new.email, role_name),
        'role', new.role_id, role_name, pg_catalog.jsonb_build_object('email', new.email)
      );
      return new;
    elsif tg_op = 'UPDATE' and new.canceled_at is distinct from old.canceled_at and new.canceled_at is not null then
      select r.name into role_name from public.roles r where r.id = new.role_id;
      perform private.record_workspace_activity(
        new.workspace_id, 'invitation.canceled',
        pg_catalog.format('Canceled the invitation for %s.', new.email),
        'role', new.role_id, role_name, pg_catalog.jsonb_build_object('email', new.email)
      );
      return new;
    elsif tg_op = 'UPDATE' and new.accepted_at is distinct from old.accepted_at and new.accepted_at is not null then
      select r.name into role_name from public.roles r where r.id = new.role_id;
      perform private.record_workspace_activity(
        new.workspace_id, 'invitation.accepted',
        pg_catalog.format('%s accepted the workspace invitation.', new.email),
        'role', new.role_id, role_name, pg_catalog.jsonb_build_object('email', new.email)
      );
      return new;
    end if;
    return new;
  end if;

  return null;
end;
$$;

revoke all on function private.record_workspace_activity(uuid, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.log_workspace_activity() from public, anon, authenticated;

create trigger workspace_activity_workspace_created
after insert on public.workspaces
for each row execute function private.log_workspace_activity();

create trigger workspace_activity_task_changes
after insert or update or delete on public.tasks
for each row execute function private.log_workspace_activity();

create trigger workspace_activity_role_changes
after insert or update or delete on public.roles
for each row execute function private.log_workspace_activity();

create trigger workspace_activity_membership_changes
after insert or update or delete on public.workspace_users
for each row execute function private.log_workspace_activity();

create trigger workspace_activity_invitation_changes
after insert or update on public.workspace_invitations
for each row execute function private.log_workspace_activity();

create or replace function public.save_workspace_role_permissions(
  target_workspace_id uuid,
  target_role_id uuid,
  permission_ids uuid[],
  expected_permission_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_ids uuid[];
  requested_ids uuid[];
  assigned_role_id uuid;
  workspace_owner boolean;
  role_name text;
  added_permissions jsonb;
  removed_permissions jsonb;
begin
  perform private.require_role_access(target_workspace_id, 'roles.update');
  select r.name into role_name
  from public.roles r
  where r.id = target_role_id and not r.is_system and r.workspace_id = target_workspace_id
  for update;
  if not found then
    raise exception 'Only custom roles in this workspace can be updated' using errcode = '42501';
  end if;

  select u.role_id, r.is_system and r.key = 'workspace.owner'
  into assigned_role_id, workspace_owner
  from public.workspace_users u
  join public.roles r on r.id = u.role_id
  where u.workspace_id = target_workspace_id and u.user_id = (select auth.uid())
  for share of u;
  if not found then
    raise exception 'You no longer have access to this workspace' using errcode = '42501';
  end if;
  if assigned_role_id = target_role_id and not workspace_owner then
    raise exception 'You cannot update a role assigned to you. Only the workspace owner can do this.'
      using errcode = '42501';
  end if;
  if permission_ids is null or expected_permission_ids is null
    or exists (
      select 1
      from unnest(permission_ids) as requested(permission_id)
      where requested.permission_id is null
        or not exists (select 1 from public.permissions p where p.id = requested.permission_id)
    ) then
    raise exception 'Invalid permission IDs' using errcode = '22023';
  end if;

  select coalesce(array_agg(rp.permission_id order by rp.permission_id), '{}'::uuid[])
  into current_ids
  from public.role_permissions rp
  where rp.role_id = target_role_id;
  select coalesce(array_agg(distinct requested.permission_id order by requested.permission_id), '{}'::uuid[])
  into requested_ids
  from unnest(permission_ids) as requested(permission_id);
  if current_ids is distinct from array(
    select distinct id from unnest(expected_permission_ids) as expected(id) order by id
  ) then
    raise exception 'This role changed elsewhere. Reload it before saving.' using errcode = '40001';
  end if;

  if current_ids is distinct from requested_ids then
    select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
    into added_permissions
    from public.permissions p
    where p.id = any(requested_ids) and not p.id = any(current_ids);
    select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
    into removed_permissions
    from public.permissions p
    where p.id = any(current_ids) and not p.id = any(requested_ids);
    perform private.record_workspace_activity(
      target_workspace_id,
      'role.permissions.updated',
      pg_catalog.format('Updated permissions for role "%s".', role_name),
      'role',
      target_role_id,
      role_name,
      pg_catalog.jsonb_build_object(
        'added_permissions', added_permissions,
        'removed_permissions', removed_permissions
      )
    );
  end if;

  delete from public.role_permissions rp where rp.role_id = target_role_id;
  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, requested.permission_id
  from unnest(requested_ids) as requested(permission_id);
end;
$$;

create or replace function public.get_workspace_role(target_workspace_id uuid, target_role_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  select jsonb_build_object(
    'id', r.id,
    'key', r.key,
    'name', r.name,
    'is_system', r.is_system,
    'member_count', (select count(*) from public.workspace_users u where u.workspace_id = target_workspace_id and u.role_id = r.id),
    'permission_ids', coalesce((
      select jsonb_agg(rp.permission_id order by rp.permission_id)
      from public.role_permissions rp
      where rp.role_id = r.id
    ), '[]'::jsonb)
  )
  into result
  from public.roles r
  where r.id = target_role_id and (r.is_system or r.workspace_id = target_workspace_id);
  if result is null then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  return result;
end;
$$;

create function public.list_workspace_activity_events(
  target_workspace_id uuid,
  page_size integer default 20,
  before_created_at timestamptz default null,
  before_id uuid default null,
  search_term text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_workspace_member(target_workspace_id) then
    raise exception 'You no longer have access to this workspace' using errcode = '42501';
  end if;
  if not private.has_workspace_permission(
    target_workspace_id,
    (select p.id from public.permissions p where p.key = 'activity.read')
  ) then
    raise exception 'You do not have permission to view workspace activity' using errcode = '42501';
  end if;
  if page_size is null or page_size < 1 or page_size > 100
    or ((before_created_at is null) <> (before_id is null)) then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;

  return (
    with page as (
      select e.id, e.event_type, e.description, e.actor_user_id, e.actor_name, e.created_at,
        e.affected_item_type, e.affected_item_id, e.affected_item_name, e.details
      from public.workspace_activity_events e
      where e.workspace_id = target_workspace_id
        and (coalesce(search_term, '') = '' or pg_catalog.strpos(pg_catalog.lower(e.description), pg_catalog.lower(pg_catalog.btrim(search_term))) > 0)
        and (before_created_at is null or (e.created_at, e.id) < (before_created_at, before_id))
      order by e.created_at desc, e.id desc
      limit page_size + 1
    )
    select jsonb_build_object(
      'events', coalesce((
        select jsonb_agg(to_jsonb(visible) order by visible.created_at desc, visible.id desc)
        from (select * from page order by created_at desc, id desc limit page_size) visible
      ), '[]'::jsonb),
      'has_more', (select count(*) > page_size from page),
      'next_cursor', (
        select jsonb_build_object('created_at', cursor_row.created_at, 'id', cursor_row.id)
        from (select * from page order by created_at desc, id desc limit page_size) cursor_row
        order by cursor_row.created_at asc, cursor_row.id asc
        limit 1
      )
    )
  );
end;
$$;

revoke all on function public.save_workspace_role_permissions(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.save_workspace_role_permissions(uuid, uuid, uuid[], uuid[]) to authenticated;
revoke all on function public.get_workspace_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_role(uuid, uuid) to authenticated;
revoke all on function public.list_workspace_activity_events(uuid, integer, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.list_workspace_activity_events(uuid, integer, timestamptz, uuid, text) to authenticated;
