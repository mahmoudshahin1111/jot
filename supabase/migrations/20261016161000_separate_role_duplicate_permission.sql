insert into public.permissions (key, name, description)
values ('roles.duplicate', 'Duplicate roles', 'Duplicate existing roles in the workspace without members.')
on conflict (key) do update set name = excluded.name, description = excluded.description;

update public.permissions
set name = 'Create roles', description = 'Create empty custom roles in the workspace.'
where key = 'roles.create';

-- Preserve the duplication access previously granted by roles.create.
insert into public.role_permissions (role_id, permission_id)
select assignments.role_id, duplicate_permission.id
from public.role_permissions assignments
join public.permissions create_permission on create_permission.id = assignments.permission_id
cross join public.permissions duplicate_permission
where create_permission.key = 'roles.create' and duplicate_permission.key = 'roles.duplicate'
on conflict (role_id, permission_id) do nothing;

create or replace function public.duplicate_workspace_role(target_workspace_id uuid, target_role_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare source_key text; source_name text; new_id uuid; candidate text; copy_suffix text; suffix integer := 1;
begin
  perform private.require_role_access(target_workspace_id, 'roles.duplicate');
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
