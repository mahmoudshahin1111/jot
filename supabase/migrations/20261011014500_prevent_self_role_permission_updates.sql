create or replace function public.get_workspace_access(target_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', w.id, 'name', w.name, 'role_id', u.role_id,
    'is_owner', r.is_system and r.key = 'workspace.owner',
    'permissions', (
      select jsonb_agg(p.key order by p.key)
      from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = u.role_id
    )
  )
  from public.workspaces w
  join public.workspace_users u on u.workspace_id = w.id
  join public.roles r on r.id = u.role_id
  where w.id = target_workspace_id and u.user_id = (select auth.uid())
    and exists (select 1 from public.role_permissions rp where rp.role_id = u.role_id);
$$;

create or replace function public.save_workspace_role_permissions(
  target_workspace_id uuid, target_role_id uuid,
  permission_ids uuid[], expected_permission_ids uuid[]
)
returns void language plpgsql security definer set search_path = ''
as $$
declare current_ids uuid[]; assigned_role_id uuid; workspace_owner boolean;
begin
  perform private.require_role_access(target_workspace_id, 'roles.update');
  perform 1 from public.roles where id = target_role_id
    and not is_system and workspace_id = target_workspace_id for update;
  if not found then
    raise exception 'Only custom roles in this workspace can be updated' using errcode = '42501';
  end if;
  select u.role_id, r.is_system and r.key = 'workspace.owner'
    into assigned_role_id, workspace_owner
  from public.workspace_users u join public.roles r on r.id = u.role_id
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
