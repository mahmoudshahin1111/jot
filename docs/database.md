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

The `public.roles` and `public.permissions` tables each have a generated UUID,
a required, non-blank machine-readable `key`, and a required, non-blank display
`name`. Permissions also have a description defaulting to an empty string.
For example, a permission has `key = 'tasks.read'` and `name = 'View tasks'`;
the owner role has `key = 'workspace.owner'` and `name = 'Owner'`.
The role list, headings, messages, permission table, and checkbox accessible
names use `name`; authorization and role pagination use `key` and UUIDs.
Filtering searches display names. Duplication appends the existing copy suffix
to both the source key and display name without assigning members.
The rename migration changes the old machine `name` column to `key` and the
old display `label` column to `name`, preserving values, IDs, and mappings.
Existing applied migrations remain unchanged. Deploy the updated RPCs and
frontend together: role pagination now accepts `after_key` instead of `after_name`,
and role/permission JSON contains `key` and `name`, not `label`.

System roles have `is_system = true` and no workspace ID; they are shared across
workspaces. Custom roles have `is_system = false` and a required `workspace_id`.
Keys are unique among system roles and within each workspace's custom roles;
permission keys are globally unique. Display names need not be unique.
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
`roles.delete`, `roles.members.add`, and `roles.members.remove`. Editors and viewers do not receive
role-management permissions by default. The role-management migration adds
these definitions and owner mappings to existing databases, without requiring
a reset or rerunning the seed.

### Workspace role management RPCs

All RPCs below require an authenticated workspace membership and the indicated
permission. They use security-definer functions with an empty search path and
explicit authenticated-only execute grants; direct table writes stay blocked.

| Function | Required permission | Behavior |
| --- | --- | --- |
| `get_workspace_access` | Membership with at least one permission | Returns the caller's workspace, assigned role ID, and permission keys, or null when access is revoked. Authenticated-only; no arbitrary user lookup. |
| `list_workspace_roles` | `roles.read` | Returns scoped roles and permission definitions with keys and display names, member counts, permission IDs, and caller capabilities. Key/UUID cursor pagination and case-insensitive name filtering support infinite scrolling. |
| `save_workspace_role_permissions` | `roles.update` | Replaces a custom role's permission mappings atomically after locking the role. Validates permission IDs and compares `expected_permission_ids` to prevent overwriting stale edits. |
| `list_workspace_role_members` | `roles.read` | Returns only users assigned to the given role in this workspace, including display name and email. Uses a user UUID cursor. |
| `remove_workspace_role_member` | `roles.members.remove` | Deletes the exact workspace/user/role membership. This revokes workspace access without deleting the account or affecting other workspaces. The last workspace owner cannot be removed. |
| `duplicate_workspace_role` | `roles.duplicate` | Clones saved permission mappings into a new workspace custom role with a unique copy name. Does not copy memberships. |
| `create_workspace_role` | `roles.create` | Validates and trims a display name and creates a workspace custom role with a generated unique key, no permissions, and no members. Returns the new role for immediate editing. |
| `list_workspace_role_candidates` | `roles.members.add` | Returns eligible existing workspace users not assigned to the selected role, with their current role, name and email. Supports name/email search and UUID cursor pagination. |
| `assign_workspace_role_member` | `roles.members.add` | Replaces an existing user's workspace role. Checks the expected previous role, role scope, caller access, and last-owner protection atomically. Does not create memberships or accounts. |
| `delete_workspace_role` | `roles.delete` | Deletes only empty custom roles in the current workspace. Remove their members first. |

Role creation requires `roles.create`; duplication requires `roles.duplicate`.
The duplication permission migration preserves existing duplication grants from
`roles.create`, after which these permissions can be managed independently.
System roles are shared and cannot be edited or deleted through these RPCs.
To customize one, duplicate it into a workspace-specific role. Custom role
changes apply to all users with that role. Role-management permissions are
administrative capabilities: a caller with `roles.update` can grant any defined
permission to a custom role. Only delegate that capability to trusted managers.
Non-owners cannot use the save RPC to change the role assigned to their own
workspace membership. Ownership means assignment to the shared system role
with key `workspace.owner`, not simply having `roles.update` or a custom role
named Owner. The access RPC returns `role_id` and `is_owner` for the UI guard;
the save RPC independently verifies and locks the caller's membership.
Owners can manage other users' custom roles; system roles remain immutable.
Creating a role opens a name-entry modal; Enter or Create role saves it and
selects its permissions editor. New roles have no permissions or memberships.
Add members selects one existing workspace user at a time and replaces their
previous role. Only owners can change their own role or manage owner assignments.
The last owner cannot be reassigned. Candidates reflect these restrictions;
the assignment RPC independently rechecks them. Assignment refreshes the selected
role's member list/count and broadcasts the user's access change through Realtime.
An empty-permission role grants no workspace access until permissions are added.
Email invitations are managed separately on the Users page.

### Workspace email invitations

`workspace_invitations` records the workspace, scoped role, normalized email,
sender, creation/expiry timestamps, delivery, acceptance, and cancellation.
Client table reads and writes are blocked; authenticated RPCs and the trusted
email Edge Function are the only supported interfaces.

| Function | Access | Behavior |
| --- | --- | --- |
| `create_workspace_invitation` | `roles.members.add` | Reserves a pending invitation; validates role scope and email, rejects existing workspace members and duplicate pending emails. Only owners can invite owners. |
| `list_my_workspace_invitations` | Authenticated sender | Lists only that sender's pending invitations across all workspaces, including those for workspaces they can no longer manage. |
| `cancel_workspace_invitation` | Invitation sender | Cancels a pending invitation, even after the sender loses workspace access. Other senders cannot remove it. |
| `get_workspace_invitation` | Confirmed invited email | Returns the workspace/role preview for a delivered, unexpired, uncanceled invitation. No anonymous invitation or account-directory lookup. |
| `accept_workspace_invitation` | Confirmed invited email | Revalidates delivery, expiry, cancellation, sender permission, and role scope; creates the membership and marks acceptance atomically. Never overwrites an existing membership. |
| `list_workspace_users` | `roles.read` | Lists members and their roles with name/email search and ten-row UUID pagination plus one lookahead row. |

The global cap is **10 pending invitations per sender**, not per workspace.
Creation, cancellation, and acceptance use the same sender advisory lock;
concurrent invitation requests cannot exceed the cap across different workspaces.
Creation also locks the workspace to prevent duplicate invitations from
different senders. Pending means unaccepted, uncanceled, and unexpired; both
delivery reservations and delivered invitations count. Invitations expire after
seven days. Acceptance, cancellation, expiry, or deletion of the associated
workspace/role frees the slot.

The `invite-workspace-user` Edge Function validates the caller with Supabase Auth,
calls the authorized reservation RPC, and sends email through Supabase Auth OTP
with a server-configured application URL. It supports both existing and new
accounts without exposing other workspaces' users. Only the trusted function can
record successful delivery. On email failure it cancels the reservation and
reports the failure; canceled links cannot grant access. The frontend never
receives service-role credentials.

Accepting does not require an existing workspace membership. A confirmed email
must match the invitation; no email or user ID supplied by the accepting client
is trusted. Other memberships remain unchanged, existing target-workspace roles
are preserved, and the normal Realtime membership notification is emitted.
Accepted invitations cannot be reused to restore removed membership.
Invitation changes broadcast only an invitation ID to the sender's private
`workspace-invitations:<user UUID>` topic. The sender's Users page reloads its
authorized list on these notifications, automatically freeing the visible slot
after acceptance. Realtime policies prevent other users subscribing to that topic.

### Realtime access notifications

The access migration broadcasts committed membership and role-permission
changes through `realtime.send` to private `workspace-access:<user UUID>` topics.
Role-permission notifications go only to users assigned to the changed role;
membership deletion notifies the removed user even after workspace access is lost.
The payload contains a workspace ID, not permission or member data. A SELECT
policy on `realtime.messages` permits receiving only the authenticated user's
topic; no client broadcast write policy is added. These notifications invalidate
client access state; RLS and RPC checks remain the authorization authority.
Realtime must be enabled in the deployed Supabase project. No Postgres Changes
publication or replica-identity changes are needed for database Broadcast.
The workspace SELECT policy also requires at least one assigned permission,
so revoked workspaces disappear from the picker and direct workspace queries.

Both list RPCs accept page sizes from 1 to 100 and return one extra lookahead
row so clients know whether another page exists. The UI requests ten rows and
uses the last displayed row as its next cursor. Member counts cover the entire
role, not just the loaded page.

The seed can be run repeatedly without duplicating rows or changing IDs.
Keys resolve permission definitions; membership and role-permission
relationships, and authorization checks, use UUIDs.
Supabase runs the seed after migrations during a local database reset.
Do not reset an existing database just to apply these permissions, since a
reset deletes local data.

Run the workspace access tests against local Supabase:

```powershell
$tests = Get-ChildItem supabase\tests\*.test.sql | ForEach-Object { $_.FullName }
npx supabase test db $tests
```

The tests run in rolled-back transactions and cover task permissions,
workspace isolation, membership removal, deletion cascades, role RPC
authorization, system-role immutability, stale permission writes, pagination,
duplication without members, and last-owner protection.

[Back to project documentation](../README.md)
