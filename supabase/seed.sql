insert into public.permissions (key, name, description)
values
  ('tasks.read', 'View tasks', 'Read tasks.'),
  ('tasks.create', 'Create tasks', 'Create tasks in the workspace.'),
  ('tasks.update', 'Update tasks', 'Update tasks.'),
  ('tasks.delete', 'Delete tasks', 'Delete tasks for all workspace members.'),
  ('roles.read', 'View roles and members', 'View workspace roles and their members.'),
  ('roles.create', 'Create roles', 'Create empty custom roles in the workspace.'),
  ('roles.duplicate', 'Duplicate roles', 'Duplicate existing roles in the workspace without members.'),
  ('roles.update', 'Update role permissions', 'Update custom role permissions.'),
  ('roles.delete', 'Delete roles', 'Delete empty custom roles.'),
  ('roles.members.add', 'Assign workspace members', 'Assign existing workspace users to a role, replacing their current role.'),
  ('roles.members.remove', 'Remove workspace members', 'Remove role members from the workspace.'),
  ('activity.read', 'View workspace activity', 'View the workspace activity history.')
on conflict (key) do update
set name = excluded.name, description = excluded.description;

insert into public.roles (key, name, is_system)
values
  ('workspace.owner', 'Owner', true),
  ('workspace.editor', 'Editor', true),
  ('workspace.viewer', 'Viewer', true)
on conflict (key) where is_system do update set name = excluded.name;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles cross join public.permissions
where roles.is_system
  and (
    (roles.key = 'workspace.owner' and (
      permissions.key in ('tasks.read', 'tasks.create', 'tasks.update', 'tasks.delete')
      or permissions.key like 'roles.%'
      or permissions.key = 'activity.read'
    ))
    or (roles.key = 'workspace.editor' and permissions.key in ('tasks.read', 'tasks.create', 'tasks.update'))
    or (roles.key = 'workspace.viewer' and permissions.key = 'tasks.read')
  )
on conflict (role_id, permission_id) do nothing;
