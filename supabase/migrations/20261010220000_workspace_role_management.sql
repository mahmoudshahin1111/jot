insert into public.permissions (name, description)
values
  ('roles.read', 'View workspace roles and their members.'),
  ('roles.create', 'Duplicate roles into workspace custom roles.'),
  ('roles.update', 'Update custom role permissions.'),
  ('roles.delete', 'Delete empty custom roles.'),
  ('roles.members.remove', 'Remove role members from the workspace.')
on conflict (name) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.is_system and r.name = 'workspace.owner' and p.name like 'roles.%'
on conflict do nothing;

create function private.require_role_access(target_workspace_id uuid, permission_name text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_workspace_member(target_workspace_id) then
    raise exception 'You no longer have access to this workspace' using errcode = '42501';
  end if;
  if not private.has_workspace_permission(target_workspace_id,
    (select id from public.permissions where name = permission_name)) then
    raise exception 'You do not have permission to perform this role action' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_role_access(uuid, text) from public, anon, authenticated;

create function public.list_workspace_roles(
  target_workspace_id uuid, page_size integer default 10,
  after_name text default null, after_id uuid default null, search_term text default ''
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  if page_size is null or page_size < 1 or page_size > 100
    or (after_name is null) <> (after_id is null) then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.name, page.id) from (
        select r.id, r.name, r.is_system,
          (select count(*) from public.workspace_users u
            where u.workspace_id = target_workspace_id and u.role_id = r.id) as member_count,
          coalesce((select jsonb_agg(rp.permission_id order by rp.permission_id)
            from public.role_permissions rp where rp.role_id = r.id), '[]'::jsonb) as permission_ids
        from public.roles r
        where (r.is_system or r.workspace_id = target_workspace_id)
          and (coalesce(search_term, '') = '' or strpos(lower(r.name), lower(search_term)) > 0)
          and (after_id is null or (r.name, r.id) > (after_name, after_id))
        order by r.name, r.id limit page_size + 1
      ) page
    ), '[]'::jsonb),
    'total', (select count(*) from public.roles r
      where (r.is_system or r.workspace_id = target_workspace_id)
        and (coalesce(search_term, '') = '' or strpos(lower(r.name), lower(search_term)) > 0)),
    'permissions', (select jsonb_agg(to_jsonb(p) order by p.name) from public.permissions p),
    'capabilities', jsonb_build_object(
      'update', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where name = 'roles.update')),
      'create', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where name = 'roles.create')),
      'delete', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where name = 'roles.delete')),
      'remove_members', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where name = 'roles.members.remove'))
    )
  ) into result;
  return result;
end;
$$;

create function public.save_workspace_role_permissions(
  target_workspace_id uuid, target_role_id uuid,
  permission_ids uuid[], expected_permission_ids uuid[]
)
returns void language plpgsql security definer set search_path = ''
as $$
declare current_ids uuid[];
begin
  perform private.require_role_access(target_workspace_id, 'roles.update');
  perform 1 from public.roles where id = target_role_id
    and not is_system and workspace_id = target_workspace_id for update;
  if not found then
    raise exception 'Only custom roles in this workspace can be updated' using errcode = '42501';
  end if;
  if permission_ids is null or expected_permission_ids is null
    or exists (select 1 from unnest(permission_ids) as requested(permission_id)
      where requested.permission_id is null or not exists (
        select 1 from public.permissions p where p.id = requested.permission_id)) then
    raise exception 'Invalid permission IDs' using errcode = '22023';
  end if;
  select coalesce(array_agg(permission_id order by permission_id), '{}'::uuid[])
    into current_ids from public.role_permissions where role_id = target_role_id;
  if current_ids is distinct from array(
    select distinct id from unnest(expected_permission_ids) id order by id
  ) then
    raise exception 'This role changed elsewhere. Reload it before saving.' using errcode = '40001';
  end if;
  delete from public.role_permissions where role_id = target_role_id;
  insert into public.role_permissions (role_id, permission_id)
    select target_role_id, id from (select distinct id from unnest(permission_ids) id) requested;
end;
$$;

create function public.list_workspace_role_members(
  target_workspace_id uuid, target_role_id uuid,
  page_size integer default 10, after_user_id uuid default null
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
    ) page), '[]'::jsonb),
    'total', (select count(*) from public.workspace_users
      where workspace_id = target_workspace_id and role_id = target_role_id)
  );
end;
$$;

create function public.remove_workspace_role_member(
  target_workspace_id uuid, target_role_id uuid, target_user_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.members.remove');
  -- Serialize membership removals so two callers cannot remove the last owners together.
  perform 1 from public.workspaces where id = target_workspace_id for update;
  if exists (select 1 from public.roles where id = target_role_id
    and is_system and name = 'workspace.owner')
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

create function public.duplicate_workspace_role(target_workspace_id uuid, target_role_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare source_name text; new_id uuid; candidate text; suffix integer := 1;
begin
  perform private.require_role_access(target_workspace_id, 'roles.create');
  select name into source_name from public.roles where id = target_role_id
    and (is_system or workspace_id = target_workspace_id) for share;
  if not found then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;
  loop
    candidate := source_name || ' (copy' || case when suffix = 1 then '' else ' ' || suffix::text end || ')';
    insert into public.roles (name, is_system, workspace_id)
      values (candidate, false, target_workspace_id) on conflict do nothing returning id into new_id;
    exit when new_id is not null;
    suffix := suffix + 1;
  end loop;
  insert into public.role_permissions (role_id, permission_id)
    select new_id, permission_id from public.role_permissions where role_id = target_role_id;
  return new_id;
end;
$$;

create function public.delete_workspace_role(target_workspace_id uuid, target_role_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.delete');
  perform 1 from public.roles where id = target_role_id
    and not is_system and workspace_id = target_workspace_id for update;
  if not found then
    raise exception 'Only custom roles in this workspace can be deleted' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspace_users
    where workspace_id = target_workspace_id and role_id = target_role_id) then
    raise exception 'Remove all members before deleting this role' using errcode = '23514';
  end if;
  delete from public.roles where id = target_role_id;
end;
$$;

revoke all on function public.list_workspace_roles(uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.save_workspace_role_permissions(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.list_workspace_role_members(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.remove_workspace_role_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.duplicate_workspace_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_workspace_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_workspace_roles(uuid, integer, text, uuid, text) to authenticated;
grant execute on function public.save_workspace_role_permissions(uuid, uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.list_workspace_role_members(uuid, uuid, integer, uuid) to authenticated;
grant execute on function public.remove_workspace_role_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.duplicate_workspace_role(uuid, uuid) to authenticated;
grant execute on function public.delete_workspace_role(uuid, uuid) to authenticated;
