alter table public.roles rename column name to key;
alter table public.roles rename column label to name;
alter table public.permissions rename column name to key;
alter table public.permissions rename column label to name;

alter index public.roles_system_name_idx rename to roles_system_key_idx;
alter index public.roles_workspace_name_idx rename to roles_workspace_key_idx;
alter table public.roles rename constraint roles_name_check to roles_key_not_blank;
alter table public.roles rename constraint roles_label_not_blank to roles_name_not_blank;
alter table public.permissions rename constraint permissions_name_key to permissions_key_unique;
alter table public.permissions rename constraint permissions_name_check to permissions_key_not_blank;
alter table public.permissions rename constraint permissions_label_not_blank to permissions_name_not_blank;

create or replace function public.create_workspace(workspace_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  creator_id uuid := auth.uid();
  owner_role_id uuid;
  new_workspace_id uuid;
begin
  if creator_id is null then
    raise exception 'You must sign in to create a workspace' using errcode = '42501';
  end if;
  if workspace_name is null or length(trim(workspace_name)) = 0 then
    raise exception 'Workspace name is required' using errcode = '22023';
  end if;
  select id into owner_role_id from public.roles
  where is_system and key = 'workspace.owner';
  if owner_role_id is null then
    raise exception 'Workspace owner role is not configured';
  end if;
  insert into public.workspaces (name) values (trim(workspace_name))
  returning id into new_workspace_id;
  insert into public.workspace_users (workspace_id, user_id, role_id)
  values (new_workspace_id, creator_id, owner_role_id);
  return new_workspace_id;
end;
$$;

create or replace function private.require_role_access(target_workspace_id uuid, permission_name text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_workspace_member(target_workspace_id) then
    raise exception 'You no longer have access to this workspace' using errcode = '42501';
  end if;
  if not private.has_workspace_permission(target_workspace_id,
    (select id from public.permissions where key = permission_name)) then
    raise exception 'You do not have permission to perform this role action' using errcode = '42501';
  end if;
end;
$$;

drop function public.list_workspace_roles(uuid, integer, text, uuid, text);
create function public.list_workspace_roles(
  target_workspace_id uuid, page_size integer default 10,
  after_key text default null, after_id uuid default null, search_term text default ''
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  if page_size is null or page_size < 1 or page_size > 100
    or (after_key is null) <> (after_id is null) then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  select jsonb_build_object(
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
    'total', (select count(*) from public.roles r
      where (r.is_system or r.workspace_id = target_workspace_id)
        and (coalesce(search_term, '') = '' or strpos(lower(r.name), lower(search_term)) > 0)),
    'permissions', (select jsonb_agg(to_jsonb(p) order by p.key) from public.permissions p),
    'capabilities', jsonb_build_object(
      'update', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where key = 'roles.update')),
      'create', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where key = 'roles.create')),
      'delete', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where key = 'roles.delete')),
      'remove_members', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where key = 'roles.members.remove'))
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.list_workspace_roles(uuid, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.list_workspace_roles(uuid, integer, text, uuid, text) to authenticated;

create or replace function public.duplicate_workspace_role(target_workspace_id uuid, target_role_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare source_key text; source_name text; new_id uuid; candidate text; copy_suffix text; suffix integer := 1;
begin
  perform private.require_role_access(target_workspace_id, 'roles.create');
  select key, name into source_key, source_name from public.roles where id = target_role_id
    and (is_system or workspace_id = target_workspace_id) for share;
  if not found then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;
  loop
    copy_suffix := ' (copy' || case when suffix = 1 then '' else ' ' || suffix::text end || ')';
    candidate := source_key || copy_suffix;
    insert into public.roles (key, name, is_system, workspace_id)
      values (candidate, source_name || copy_suffix, false, target_workspace_id)
      on conflict do nothing returning id into new_id;
    exit when new_id is not null;
    suffix := suffix + 1;
  end loop;
  insert into public.role_permissions (role_id, permission_id)
    select new_id, permission_id from public.role_permissions where role_id = target_role_id;
  return new_id;
end;
$$;

create or replace function public.remove_workspace_role_member(
  target_workspace_id uuid, target_role_id uuid, target_user_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.members.remove');
  -- Serialize removals so concurrent callers cannot remove the last owners together.
  perform 1 from public.workspaces where id = target_workspace_id for update;
  if exists (select 1 from public.roles where id = target_role_id
    and is_system and key = 'workspace.owner')
    and (select count(*) from public.workspace_users
      where workspace_id = target_workspace_id and role_id = target_role_id) <= 1 then
    raise exception 'The last workspace owner cannot be removed' using errcode = '23514';
  end if;
  delete from public.workspace_users where workspace_id = target_workspace_id
    and role_id = target_role_id and user_id = target_user_id;
  if not found then
    raise exception 'This user is no longer assigned to this role' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.get_workspace_access(target_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', w.id, 'name', w.name, 'role_id', u.role_id,
    'permissions', (
      select jsonb_agg(p.key order by p.key)
      from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = u.role_id
    )
  )
  from public.workspaces w
  join public.workspace_users u on u.workspace_id = w.id
  where w.id = target_workspace_id and u.user_id = (select auth.uid())
    and exists (select 1 from public.role_permissions rp where rp.role_id = u.role_id);
$$;
