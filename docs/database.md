# Database and access control

See [Local development](./README.md) for starting Supabase and applying migrations.

The `public.workspaces` table stores a generated UUID, a required non-empty name,
and a creation timestamp. The `public.workspace_users` table links Supabase Auth
users to workspaces, with one `role_id` per membership and a composite primary
key of `(workspace_id, user_id)`.

Each `public.tasks` row belongs to a workspace through its required
`workspace_id`. It also has a generated UUID, a required non-empty title,
a description defaulting to an empty string, and a creation timestamp.
Tasks cannot be moved between workspaces.

No root or default workspace is created by migrations or seeds. Signup
onboarding requires a user to belong to at least one workspace before
continuing. Users without memberships are directed to workspace creation.

The workspace migration replaces `task_users` with `workspace_users`. A fresh
database starts with no workspaces or memberships. Legacy task data or custom
roles require an explicit data migration rather than automatic assignment.
A follow-up migration removes the empty placeholder from earlier local setups
and refuses to remove it if it contains tasks, members, or custom roles.
All workspace tasks are accessible to each member according to their workspace
role, rather than individual task sharing.

RLS permits members to read their workspace and their own membership row.
Task read, update, and delete policies check the member's role and permission
IDs. Deleting a task deletes it for every member of that workspace.
Deleting a user removes their memberships, not workspace tasks. Deleting a
workspace through a trusted administrative connection removes its tasks,
memberships, and custom roles.

Anonymous access and client task creation remain blocked. Other workspace,
membership, role, and permission management must currently use a trusted
administrative connection. Leaving individual tasks is no longer supported;
workspace membership management will be added separately.

Authenticated users can call `public.create_workspace(workspace_name)` to
create a workspace and assign themselves the shared `workspace.owner` role
in one transaction. The function takes no user or role ID from the client,
validates the name, and rejects unauthenticated callers. Direct client inserts
into workspaces and memberships remain blocked. Existing workspace membership
is checked through the RLS-protected workspace query.

## Roles and permissions

The `public.roles` and `public.permissions` tables each have a generated UUID
and a required, unique, non-empty name. Permissions also have a description
defaulting to an empty string.

System roles have `is_system = true` and no workspace ID; they are shared across
workspaces. Custom roles have `is_system = false` and a required `workspace_id`.
Names are unique among system roles and within each workspace's custom roles.
Role scope cannot be changed after creation. A membership can use a system role
or a custom role from the same workspace, never another workspace's custom role.

The `public.role_permissions` table links roles to permissions. Its composite
primary key prevents duplicate mappings, and deleting a role or permission
removes its mappings without deleting the other entity. A permission index
supports reverse lookups.

Authenticated users can read system roles, their workspaces' custom roles,
associated permission mappings, and permission definitions. Client writes to
these tables remain blocked, preventing users from escalating their privileges.
Permission checks use narrowly scoped security-definer functions in the
unexposed `private` schema to avoid recursive RLS on membership tables.

The migration and configured [seed file](../supabase/seed.sql) install the following shared
system roles and permission mappings:

| Role | Read tasks | Update tasks | Delete tasks |
| --- | --- | --- | --- |
| `workspace.owner` | Yes | Yes | Yes |
| `workspace.editor` | Yes | Yes | No |
| `workspace.viewer` | Yes | No | No |

The seed can be run repeatedly without duplicating rows or changing IDs.
Names resolve permission definitions; membership and role-permission
relationships, and authorization checks, use UUIDs.
Supabase runs the seed after migrations during a local database reset.
Do not reset an existing database just to apply these permissions, since a
reset deletes local data.

Run the workspace access tests against local Supabase:

```powershell
npx supabase test db
```

The tests run in a rolled-back transaction and cover role permissions,
workspace isolation, membership removal, and deletion cascades.

[Back to project documentation](../README.md)
