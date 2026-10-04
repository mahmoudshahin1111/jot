do $$
begin
  if exists (select 1 from public.tasks)
    or exists (select 1 from public.task_users)
    or exists (select 1 from public.roles where not is_system) then
    raise exception 'Existing task data or custom roles require an explicit workspace migration before applying this migration';
  end if;
end;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

alter table public.tasks
add column workspace_id uuid references public.workspaces(id) on delete cascade;

alter table public.tasks alter column workspace_id set not null;
create index tasks_workspace_id_idx on public.tasks (workspace_id);

alter table public.roles
add column workspace_id uuid references public.workspaces(id) on delete cascade;

alter table public.roles drop constraint roles_name_key;
alter table public.roles
add constraint roles_scope_check check (
  (is_system and workspace_id is null)
  or (not is_system and workspace_id is not null)
);

create unique index roles_system_name_idx on public.roles (name) where is_system;
create unique index roles_workspace_name_idx on public.roles (workspace_id, name)
where not is_system;

insert into public.permissions (name, description)
values
  ('tasks.read', 'Read tasks.'),
  ('tasks.update', 'Update tasks.'),
  ('tasks.delete', 'Delete tasks for all workspace members.')
on conflict (name) do update set description = excluded.description;

insert into public.roles (name, is_system)
values ('workspace.owner', true), ('workspace.editor', true), ('workspace.viewer', true)
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

create table public.workspace_users (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  primary key (workspace_id, user_id)
);

create index workspace_users_user_id_idx on public.workspace_users (user_id);
create index workspace_users_role_id_idx on public.workspace_users (role_id);

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.validate_workspace_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.roles
    where id = new.role_id
      and (is_system or workspace_id = new.workspace_id)
  ) then
    raise exception 'Role must be a system role or belong to the same workspace'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger workspace_users_validate_role
before insert or update on public.workspace_users
for each row execute function private.validate_workspace_role();

create function private.prevent_role_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.is_system is distinct from old.is_system then
    raise exception 'Role scope cannot be changed; create a new role instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger roles_prevent_scope_change
before update on public.roles
for each row execute function private.prevent_role_scope_change();

create function private.prevent_task_workspace_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'Tasks cannot be moved between workspaces'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tasks_prevent_workspace_change
before update on public.tasks
for each row execute function private.prevent_task_workspace_change();

create function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_users
    where workspace_id = target_workspace_id
      and user_id = (select auth.uid())
  );
$$;

create function private.has_workspace_permission(target_workspace_id uuid, required_permission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_users
    join public.roles on roles.id = workspace_users.role_id
    join public.role_permissions on role_permissions.role_id = roles.id
    where workspace_users.workspace_id = target_workspace_id
      and workspace_users.user_id = (select auth.uid())
      and (roles.is_system or roles.workspace_id = target_workspace_id)
      and role_permissions.permission_id = required_permission_id
  );
$$;

revoke all on function private.validate_workspace_role() from public, anon, authenticated;
revoke all on function private.prevent_role_scope_change() from public, anon, authenticated;
revoke all on function private.prevent_task_workspace_change() from public, anon, authenticated;
revoke all on function private.is_workspace_member(uuid) from public, anon, authenticated;
revoke all on function private.has_workspace_permission(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_permission(uuid, uuid) to authenticated;

drop policy "Users can read their tasks" on public.tasks;
drop policy "Users can update their tasks" on public.tasks;
drop table public.task_users;

alter table public.workspaces enable row level security;
alter table public.workspace_users enable row level security;

create policy "Members can read their workspaces"
on public.workspaces for select to authenticated
using (private.is_workspace_member(id));

create policy "Users can read their own workspace memberships"
on public.workspace_users for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users can read available roles"
on public.roles for select to authenticated
using (is_system or private.is_workspace_member(workspace_id));

create policy "Users can read permission definitions"
on public.permissions for select to authenticated
using (true);

create policy "Users can read available role permissions"
on public.role_permissions for select to authenticated
using (exists (select 1 from public.roles where roles.id = role_permissions.role_id));

create policy "Members with read permission can read workspace tasks"
on public.tasks for select to authenticated
using (
  private.has_workspace_permission(workspace_id, (select id from public.permissions where name = 'tasks.read'))
);

create policy "Members with update permission can update workspace tasks"
on public.tasks for update to authenticated
using (
  private.has_workspace_permission(workspace_id, (select id from public.permissions where name = 'tasks.update'))
)
with check (
  private.has_workspace_permission(workspace_id, (select id from public.permissions where name = 'tasks.update'))
);

create policy "Members with delete permission can delete workspace tasks"
on public.tasks for delete to authenticated
using (
  private.has_workspace_permission(workspace_id, (select id from public.permissions where name = 'tasks.delete'))
);