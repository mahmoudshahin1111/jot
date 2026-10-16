create index tasks_workspace_page_idx on public.tasks (workspace_id, created_at, id);

create function public.list_my_workspaces(
  page_size integer default 100, after_created_at timestamptz default null, after_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view workspaces' using errcode = '42501';
  end if;
  if page_size is null or page_size < 1 or page_size > 100
    or (after_created_at is null) <> (after_id is null) then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at, page.id) from (
    select w.id, w.name, w.created_at
    from public.workspaces w
    join public.workspace_users u on u.workspace_id = w.id
    where u.user_id = auth.uid()
      and public.get_workspace_access(w.id) is not null
      and (after_id is null or (w.created_at, w.id) > (after_created_at, after_id))
    order by w.created_at, w.id limit page_size
  ) page), '[]'::jsonb);
end;
$$;

create function private.require_task_access(target_workspace_id uuid, permission_key text)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_workspace_permission(target_workspace_id,
    (select id from public.permissions where key = permission_key)) then
    raise exception 'You do not have permission to perform this task action' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_task_access(uuid, text) from public, anon, authenticated;

create function public.list_workspace_tasks(
  target_workspace_id uuid, page_size integer default 100,
  after_created_at timestamptz default null, after_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_task_access(target_workspace_id, 'tasks.read');
  if page_size is null or page_size < 1 or page_size > 100
    or (after_created_at is null) <> (after_id is null) then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at, page.id) from (
    select t.id, t.title, t.description, t.status, t.created_at
    from public.tasks t
    where t.workspace_id = target_workspace_id
      and (after_id is null or (t.created_at, t.id) > (after_created_at, after_id))
    order by t.created_at, t.id limit page_size
  ) page), '[]'::jsonb);
end;
$$;

create function public.create_workspace_task(target_workspace_id uuid, task_title text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare task public.tasks;
begin
  perform private.require_task_access(target_workspace_id, 'tasks.create');
  if task_title is null or length(btrim(task_title)) = 0 then
    raise exception 'Task name is required' using errcode = '22023';
  end if;
  insert into public.tasks(workspace_id, title) values (target_workspace_id, btrim(task_title))
    returning * into task;
  return jsonb_build_object('id', task.id, 'title', task.title,
    'description', task.description, 'status', task.status);
end;
$$;

-- A null title/description leaves that field unchanged, allowing status-only saves.
create function public.update_workspace_task(
  target_workspace_id uuid, target_task_id uuid, task_status text,
  task_title text default null, task_description text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare task public.tasks;
begin
  perform private.require_task_access(target_workspace_id, 'tasks.update');
  if task_status is null or task_status not in ('todo', 'in_progress', 'done')
    or (task_title is not null and length(btrim(task_title)) = 0) then
    raise exception 'Enter a valid task title and status' using errcode = '22023';
  end if;
  update public.tasks set status = task_status,
    title = coalesce(btrim(task_title), title), description = coalesce(task_description, description)
    where workspace_id = target_workspace_id and id = target_task_id
    returning * into task;
  if not found then
    raise exception 'Task is not available in this workspace' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', task.id, 'title', task.title,
    'description', task.description, 'status', task.status);
end;
$$;

create function public.delete_workspace_task(target_workspace_id uuid, target_task_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare deleted_id uuid;
begin
  perform private.require_task_access(target_workspace_id, 'tasks.delete');
  delete from public.tasks where workspace_id = target_workspace_id and id = target_task_id
    returning id into deleted_id;
  if not found then
    raise exception 'Task is not available in this workspace' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', deleted_id);
end;
$$;

create function public.duplicate_workspace_role_details(target_workspace_id uuid, target_role_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  new_id := public.duplicate_workspace_role(target_workspace_id, target_role_id);
  return (select jsonb_build_object(
    'id', r.id, 'key', r.key, 'name', r.name, 'is_system', r.is_system, 'member_count', 0,
    'permission_ids', coalesce((select jsonb_agg(rp.permission_id order by rp.permission_id)
      from public.role_permissions rp where rp.role_id = r.id), '[]'::jsonb)
  ) from public.roles r where r.id = new_id);
end;
$$;

revoke all on function public.list_my_workspaces(integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.list_workspace_tasks(uuid, integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.create_workspace_task(uuid, text) from public, anon, authenticated;
revoke all on function public.update_workspace_task(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_workspace_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.duplicate_workspace_role_details(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_my_workspaces(integer, timestamptz, uuid) to authenticated;
grant execute on function public.list_workspace_tasks(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.create_workspace_task(uuid, text) to authenticated;
grant execute on function public.update_workspace_task(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.delete_workspace_task(uuid, uuid) to authenticated;
grant execute on function public.duplicate_workspace_role_details(uuid, uuid) to authenticated;

revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;

-- Table-level revocation does not remove separately granted column privileges.
do $$
declare relation record; columns text;
begin
  for relation in select c.oid, c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'f')
  loop
    select string_agg(format('%I', a.attname), ', ') into columns
      from pg_catalog.pg_attribute a
      where a.attrelid = relation.oid and a.attnum > 0 and not a.attisdropped;
    if columns is not null then
      execute format('revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s)
        on table public.%2$I from public, anon, authenticated', columns, relation.relname);
    end if;
  end loop;
end;
$$;

revoke create on schema public from public, anon, authenticated;

-- Migrations create application objects as postgres, not Supabase's internal owners.
-- Global defaults must be revoked too: schema defaults alone cannot override them.
alter default privileges for role postgres revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
