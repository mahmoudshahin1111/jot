insert into public.permissions (name, description)
values
  ('tasks.read', 'Read tasks.'),
  ('tasks.update', 'Update tasks.'),
  ('tasks.delete', 'Delete tasks for all workspace members.')
on conflict (name) do update
set description = excluded.description;

insert into public.roles (name, is_system)
values
  ('workspace.owner', true),
  ('workspace.editor', true),
  ('workspace.viewer', true)
on conflict (name) where is_system do nothing;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles cross join public.permissions
where roles.is_system
  and (
    (roles.name = 'workspace.owner' and permissions.name in ('tasks.read', 'tasks.update', 'tasks.delete'))
    or (roles.name = 'workspace.editor' and permissions.name in ('tasks.read', 'tasks.update'))
    or (roles.name = 'workspace.viewer' and permissions.name = 'tasks.read')
  )
on conflict (role_id, permission_id) do nothing;
