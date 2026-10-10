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

Anonymous access and client task creation remain blocked. Workspace role
management uses the authorized RPCs described below; other direct workspace,
membership, role, and permission writes remain blocked. Leaving individual
tasks is no longer supported.

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
Permissions have a required, non-blank `label` for human-readable display
(for example, `View tasks`). The roles table and checkbox accessible names use
this label. The unique `name` remains the machine-readable authorization key
(for example, `tasks.read`); labels do not affect permission checks or UUID
mappings. The label migration backfills existing records without changing IDs,
and the seed maintains labels alongside descriptions.
Roles also have a required, non-blank `label`. Shared system roles display
Owner, Editor, and Viewer while keeping their `workspace.*` machine names.
Existing custom roles retain their names as their initial labels. The role
list, heading, and messages display labels; filtering searches labels.
Duplication copies the source label with the same copy suffix as the new
machine name. Pagination and authorization continue using machine names and IDs.

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
these tables remain blocked; authorized role changes use narrowly scoped RPCs.
Permission checks use narrowly scoped security-definer functions in the
unexposed `private` schema to avoid recursive RLS on membership tables.

The migration and configured [seed file](../supabase/seed.sql) install the following shared
system roles and permission mappings:

| Role | Read tasks | Update tasks | Delete tasks |
| --- | --- | --- | --- |
| `workspace.owner` | Yes | Yes | Yes |
| `workspace.editor` | Yes | Yes | No |
| `workspace.viewer` | Yes | No | No |

The owner role also receives `roles.read`, `roles.create`, `roles.update`,
`roles.delete`, and `roles.members.remove`. Editors and viewers do not receive
role-management permissions by default. The role-management migration adds
these definitions and owner mappings to existing databases, without requiring
a reset or rerunning the seed.

### Workspace role management RPCs

All RPCs below require an authenticated workspace membership and the indicated
permission. They use security-definer functions with an empty search path and
explicit authenticated-only execute grants; direct table writes stay blocked.

| Function | Required permission | Behavior |
| --- | --- | --- |
| `list_workspace_roles` | `roles.read` | Returns scoped roles with labels, member counts, permission IDs, definitions, and caller capabilities. Machine-name/UUID cursor pagination and case-insensitive label filtering support infinite scrolling. |
| `save_workspace_role_permissions` | `roles.update` | Replaces a custom role's permission mappings atomically after locking the role. Validates permission IDs and compares `expected_permission_ids` to prevent overwriting stale edits. |
| `list_workspace_role_members` | `roles.read` | Returns only users assigned to the given role in this workspace, including display name and email. Uses a user UUID cursor. |
| `remove_workspace_role_member` | `roles.members.remove` | Deletes the exact workspace/user/role membership. This revokes workspace access without deleting the account or affecting other workspaces. The last workspace owner cannot be removed. |
| `duplicate_workspace_role` | `roles.create` | Clones saved permission mappings into a new workspace custom role with a unique copy name. Does not copy memberships. |
| `delete_workspace_role` | `roles.delete` | Deletes only empty custom roles in the current workspace. Remove their members first. |

System roles are shared and cannot be edited or deleted through these RPCs.
To customize one, duplicate it into a workspace-specific role. Custom role
changes apply to all users with that role. Role-management permissions are
administrative capabilities: a caller with `roles.update` can grant any defined
permission to a custom role. Only delegate that capability to trusted managers.
Creation and assignment/add-member workflows are not implemented yet.

Both list RPCs accept page sizes from 1 to 100 and return one extra lookahead
row so clients know whether another page exists. The UI requests ten rows and
uses the last displayed row as its next cursor. Member counts cover the entire
role, not just the loaded page.

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

The tests run in rolled-back transactions and cover task permissions,
workspace isolation, membership removal, deletion cascades, role RPC
authorization, system-role immutability, stale permission writes, pagination,
duplication without members, and last-owner protection.

[Back to project documentation](../README.md)
