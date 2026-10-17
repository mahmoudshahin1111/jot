create or replace function public.list_workspace_activity_events(
  target_workspace_id uuid, page_size integer default 20,
  before_created_at timestamptz default null, before_id uuid default null, search_term text default ''
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'activity.read');
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
      order by e.created_at desc, e.id desc limit page_size + 1
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
        order by cursor_row.created_at asc, cursor_row.id asc limit 1
      )
    )
  );
end;
$$;

create function public.count_workspace_activity_events(target_workspace_id uuid, search_term text default '')
returns bigint language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'activity.read');
  return (select count(*) from public.workspace_activity_events e
    where e.workspace_id = target_workspace_id
      and (coalesce(search_term, '') = '' or pg_catalog.strpos(pg_catalog.lower(e.description), pg_catalog.lower(pg_catalog.btrim(search_term))) > 0));
end;
$$;

create or replace function public.list_workspace_roles(
  target_workspace_id uuid, page_size integer default 10,
  after_key text default null, after_id uuid default null, search_term text default ''
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  if page_size is null or page_size < 1 or page_size > 100
    or (after_key is null) <> (after_id is null) then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.key, page.id) from (
        select r.id, r.key, r.name, r.is_system,
          (select count(*) from public.workspace_users u
            where u.workspace_id = target_workspace_id and u.role_id = r.id) as member_count,
          coalesce((select jsonb_agg(rp.permission_id order by rp.permission_id)
            from public.role_permissions rp where rp.role_id = r.id), '[]'::jsonb) as permission_ids
        from public.roles r
        where (r.is_system or r.workspace_id = target_workspace_id)
          and (coalesce(search_term, '') = '' or strpos(lower(r.name), lower(search_term)) > 0)
          and (after_id is null or (r.key, r.id) > (after_key, after_id))
        order by r.key, r.id limit page_size + 1
      ) page
    ), '[]'::jsonb),
    'permissions', (select jsonb_agg(to_jsonb(p) order by p.key) from public.permissions p),
    'capabilities', jsonb_build_object(
      'update', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where key = 'roles.update')),
      'create', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where key = 'roles.create')),
      'delete', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where key = 'roles.delete')),
      'remove_members', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where key = 'roles.members.remove'))
    )
  );
end;
$$;

create function public.count_workspace_roles(target_workspace_id uuid, search_term text default '')
returns bigint language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  return (select count(*) from public.roles r
    where (r.is_system or r.workspace_id = target_workspace_id)
      and (coalesce(search_term, '') = '' or strpos(lower(r.name), lower(search_term)) > 0));
end;
$$;

create or replace function public.list_workspace_role_members(
  target_workspace_id uuid, target_role_id uuid, page_size integer default 10, after_user_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  if page_size is null or page_size < 1 or page_size > 100 then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.roles where id = target_role_id
    and (is_system or workspace_id = target_workspace_id)) then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(to_jsonb(page) order by page.user_id) from (
      select u.user_id, coalesce(a.email, '') as email,
        coalesce(nullif(a.raw_user_meta_data->>'full_name', ''), nullif(a.email, ''), 'Workspace member') as name
      from public.workspace_users u join auth.users a on a.id = u.user_id
      where u.workspace_id = target_workspace_id and u.role_id = target_role_id
        and (after_user_id is null or u.user_id > after_user_id)
      order by u.user_id limit page_size + 1
    ) page), '[]'::jsonb)
  );
end;
$$;

create function public.count_workspace_role_members(target_workspace_id uuid, target_role_id uuid)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  if not exists (select 1 from public.roles where id = target_role_id
    and (is_system or workspace_id = target_workspace_id)) then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  return (select count(*) from public.workspace_users u join auth.users a on a.id = u.user_id
    where u.workspace_id = target_workspace_id and u.role_id = target_role_id);
end;
$$;

create or replace function public.list_workspace_users(
  target_workspace_id uuid, search_term text default '', after_user_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  return jsonb_build_object(
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

create function public.count_workspace_users(target_workspace_id uuid, search_term text default '')
returns bigint language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  return (select count(*) from public.workspace_users u
    join auth.users a on a.id = u.user_id join public.roles r on r.id = u.role_id
    where u.workspace_id = target_workspace_id
      and (coalesce(search_term, '') = '' or strpos(lower(coalesce(a.email, '')), lower(search_term)) > 0
        or strpos(lower(coalesce(a.raw_user_meta_data->>'full_name', '')), lower(search_term)) > 0));
end;
$$;

create function public.count_workspace_tasks(
  target_workspace_id uuid, search_term text default '', task_status text default null
)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_task_access(target_workspace_id, 'tasks.read');
  if task_status is not null and task_status not in ('todo', 'in_progress', 'done') then
    raise exception 'Invalid task status' using errcode = '22023';
  end if;
  return (select count(*) from public.tasks t where t.workspace_id = target_workspace_id
    and (task_status is null or t.status = task_status)
    and (coalesce(search_term, '') = '' or strpos(lower(t.title), lower(search_term)) > 0
      or strpos(lower(t.description), lower(search_term)) > 0));
end;
$$;

create function public.count_my_workspaces(search_term text default '')
returns bigint language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view workspaces' using errcode = '42501';
  end if;
  return (select count(*) from public.workspaces w
    join public.workspace_users u on u.workspace_id = w.id
    where u.user_id = auth.uid() and public.get_workspace_access(w.id) is not null
      and (coalesce(search_term, '') = '' or strpos(lower(w.name), lower(search_term)) > 0));
end;
$$;

create function public.count_my_workspace_invitations()
returns bigint language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view invitations' using errcode = '42501';
  end if;
  return (select count(*) from public.workspace_invitations i
    where i.invited_by = auth.uid() and i.accepted_at is null and i.canceled_at is null and i.expires_at > now());
end;
$$;

revoke all on function public.count_workspace_activity_events(uuid, text) from public, anon, authenticated;
revoke all on function public.count_workspace_roles(uuid, text) from public, anon, authenticated;
revoke all on function public.count_workspace_role_members(uuid, uuid) from public, anon, authenticated;
revoke all on function public.count_workspace_users(uuid, text) from public, anon, authenticated;
revoke all on function public.count_workspace_tasks(uuid, text, text) from public, anon, authenticated;
revoke all on function public.count_my_workspaces(text) from public, anon, authenticated;
revoke all on function public.count_my_workspace_invitations() from public, anon, authenticated;
grant execute on function public.count_workspace_activity_events(uuid, text) to authenticated;
grant execute on function public.count_workspace_roles(uuid, text) to authenticated;
grant execute on function public.count_workspace_role_members(uuid, uuid) to authenticated;
grant execute on function public.count_workspace_users(uuid, text) to authenticated;
grant execute on function public.count_workspace_tasks(uuid, text, text) to authenticated;
grant execute on function public.count_my_workspaces(text) to authenticated;
grant execute on function public.count_my_workspace_invitations() to authenticated;
