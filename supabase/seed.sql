insert into public.permissions (name, label, description)
values
  ('tasks.read', 'View tasks', 'Read tasks.'),
  ('tasks.update', 'Update tasks', 'Update tasks.'),
  ('tasks.delete', 'Delete tasks', 'Delete tasks for all workspace members.'),
  ('roles.read', 'View roles and members', 'View workspace roles and their members.'),
  ('roles.create', 'Duplicate roles', 'Duplicate roles into workspace custom roles.'),
  ('roles.update', 'Update role permissions', 'Update custom role permissions.'),
  ('roles.delete', 'Delete roles', 'Delete empty custom roles.'),
  ('roles.members.remove', 'Remove workspace members', 'Remove role members from the workspace.')
on conflict (name) do update
set label = excluded.label, description = excluded.description;

insert into public.roles (name, label, is_system)
values
  ('workspace.owner', 'Owner', true),
  ('workspace.editor', 'Editor', true),
  ('workspace.viewer', 'Viewer', true)
on conflict (name) where is_system do update set label = excluded.label;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles cross join public.permissions
where roles.is_system
  and (
    (roles.name = 'workspace.owner' and (
      permissions.name in ('tasks.read', 'tasks.update', 'tasks.delete')
      or permissions.name like 'roles.%'
    ))
    or (roles.name = 'workspace.editor' and permissions.name in ('tasks.read', 'tasks.update'))
    or (roles.name = 'workspace.viewer' and permissions.name = 'tasks.read')
  )
on conflict (role_id, permission_id) do nothing;
