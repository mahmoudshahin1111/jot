update public.permissions
set name = 'Create and duplicate roles',
    description = 'Create empty custom roles or duplicate existing roles in the workspace.'
where key = 'roles.create';

create function public.create_workspace_role(target_workspace_id uuid, role_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare new_role public.roles;
begin
  perform private.require_role_access(target_workspace_id, 'roles.create');
  if role_name is null or length(trim(role_name)) = 0 then
    raise exception 'Role name is required' using errcode = '22023';
  end if;
  insert into public.roles (key, name, is_system, workspace_id)
    values ('custom.' || gen_random_uuid()::text, trim(role_name), false, target_workspace_id)
    returning * into new_role;
  return jsonb_build_object(
    'id', new_role.id, 'key', new_role.key, 'name', new_role.name,
    'is_system', new_role.is_system, 'member_count', 0, 'permission_ids', '[]'::jsonb
  );
end;
$$;

revoke all on function public.create_workspace_role(uuid, text) from public, anon, authenticated;
grant execute on function public.create_workspace_role(uuid, text) to authenticated;
