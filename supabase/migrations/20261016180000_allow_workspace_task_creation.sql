insert into public.permissions (key, name, description)
values ('tasks.create', 'Create tasks', 'Create tasks in the workspace.')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles cross join public.permissions
where roles.is_system and roles.key in ('workspace.owner', 'workspace.editor')
  and permissions.key = 'tasks.create'
on conflict (role_id, permission_id) do nothing;

create policy "Members with create permission can create workspace tasks"
on public.tasks for insert to authenticated
with check (
  private.has_workspace_permission(workspace_id, (select id from public.permissions where key = 'tasks.create'))
);
