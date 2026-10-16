# Database and access control

See [Local development](./README.md) for starting Supabase and applying migrations.

The `public.workspaces` table stores a generated UUID, a required non-empty name,
and a creation timestamp. The `public.workspace_users` table links Supabase Auth
users to workspaces, with one `role_id` per membership and a composite primary
key of `(workspace_id, user_id)`.

Each `public.tasks` row belongs to a workspace through its required
`workspace_id`. It also has a generated UUID, a required non-empty title,
a description defaulting to an empty string, and a creation timestamp.
Tasks cannot be moved between workspaces. Each task also has a required
`status` of `todo` (default), `in_progress` or `done`. The workspace Tasks page
reads tasks through `list_workspace_tasks`, which requires `tasks.read`.

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

RLS remains enabled as defense in depth, but application table privileges are
revoked from `PUBLIC`, `anon`, and `authenticated`, including column grants.
Clients cannot directly SELECT, INSERT, UPDATE, or DELETE any application table,
even as workspace owners. Sequence privileges and public-schema object creation
are also denied. Supabase-managed `auth`, `storage`, and `realtime` schemas are
not changed. Trusted administrative connections and server-only `service_role`
access are preserved.

Existing RLS policies permit members to read their workspace and their own
membership row. Task read, create, update, and delete policies check the member's
role and permission IDs. Deleting a task deletes it for every member of that workspace.
Deleting a user removes their memberships, not workspace tasks. Deleting a
workspace through a trusted administrative connection removes its tasks,
memberships, and custom roles.

Anonymous access remains blocked. Authenticated clients can create tasks only
through `create_workspace_task` with `tasks.create` in the target workspace.
Task names must not be blank; the inline form trims names and uses the database defaults of an empty description
and `todo` status. Owners and Editors receive `tasks.create` by default.
Workspace role
management uses the authorized RPCs described below; all direct application
table reads and writes are blocked. Leaving individual
tasks is no longer supported.

Authenticated users can call `public.create_workspace(workspace_name)` to
create a workspace and assign themselves the shared `workspace.owner` role
in one transaction. The function takes no user or role ID from the client,
validates the name, and rejects unauthenticated callers. Direct client inserts
into workspaces and memberships remain blocked. Existing workspace membership
is checked through `get_workspace_access`; `list_my_workspaces` returns only
the caller's accessible workspaces.

## RPC-only client access

Apply `20261016210000_require_application_rpcs.sql` before deploying the matching
frontend, preferably in a coordinated deployment: older clients using direct
table queries will receive permission errors after the migration.
All client data access in `src/lib/` uses RPCs. Each security-definer RPC uses an
empty search path, schema-qualified objects, caller-bound authorization, and
an explicit authenticated execute grant. UI permission checks are not a
substitute for these database checks.

| Function | Required permission | Behavior |
| --- | --- | --- |
| `list_my_workspaces` | Authenticated membership with at least one permission | Returns only accessible workspaces. |
| `list_workspace_tasks` | `tasks.read` | Lists tasks in exactly one authorized workspace. |
| `create_workspace_task` | `tasks.create` | Validates and trims the title; returns the new task with default description and status. |
| `update_workspace_task` | `tasks.update` | Updates a task by workspace and task UUID, validates title/status, and returns the saved task. Omitted/null title or description leaves that field unchanged, supporting status-only saves. Status is required. |
| `delete_workspace_task` | `tasks.delete` | Deletes exactly one workspace-scoped task and returns its UUID. |
| `duplicate_workspace_role_details` | `roles.duplicate` | Calls the existing authorized duplication function and returns the new role and permission IDs atomically, without follow-up table reads. |

The two new list RPCs accept `page_size` from **1 to 100** (default 100).
They return at most that many rows, ordered by `(created_at, id)`; pass both
`after_created_at` and `after_id` from the last row for the next page. Null,
oversized, or nonpositive page sizes and partial cursors are rejected.
Task timestamps retain database precision in the cursor. The frontend fetches
all pages so workspace choices, task counts, filters, and search remain complete;
the bound is per RPC call, not a total client-side task limit. Existing role/user
list RPCs keep their bounded page-plus-one lookahead contracts. Pending invitation
lists are bounded by the ten-invitation sender cap.

Unauthorized RPCs raise permission errors; missing or wrong-workspace tasks
raise a not-found error rather than returning a successful empty mutation.
Task updates cannot change workspace membership or any task's workspace UUID.
Access revocation is checked again on each RPC call.

Default privileges for the `postgres` migration owner no longer grant clients
access to future tables, sequences, or functions. New RPCs must explicitly grant
EXECUTE only to the intended caller roles. PostgreSQL's global function default
must also be revoked because a schema-level default cannot override it.
Objects created by another owner require equivalent default-privilege setup by
that owner; Supabase internal owner defaults are not modified.

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

Authenticated users with `roles.read` can read scoped role and permission details
through role-management RPCs. Direct table reads and writes remain blocked;
authorized role changes use narrowly scoped RPCs.
Permission checks use narrowly scoped security-definer functions in the
unexposed `private` schema to avoid recursive RLS on membership tables.

The migration and configured [seed file](../supabase/seed.sql) install the following shared
system roles and permission mappings:

| Role | Read tasks | Create tasks | Update tasks | Delete tasks |
| --- | --- | --- | --- | --- |
| `workspace.owner` | Yes | Yes | Yes | Yes |
| `workspace.editor` | Yes | Yes | Yes | No |
| `workspace.viewer` | Yes | No | No | No |

The owner role also receives `roles.read`, `roles.create`, `roles.update`,
`roles.delete`, `roles.members.add`, and `roles.members.remove`. Editors and viewers do not receive
role-management permissions by default. The role-management migration adds
these definitions and owner mappings to existing databases, without requiring
a reset or rerunning the seed.

### Workspace role management RPCs

All RPCs below require an authenticated workspace membership and the indicated
permission. They use security-definer functions with an empty search path and
explicit authenticated-only execute grants; direct table access stays blocked.

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

### Workspace activity

`activity.read` (granted to the Owner role by default) controls the Activity
page, including direct URL access. Database triggers log events (workspace,
task, role, member and invitation changes, plus role permission saves) into
`workspace_activity_events` with the event type, description, actor, timestamp
and the affected item's id and name, so entries survive deletion of the item.
The table has no client grants; clients only use RPCs:

- `list_workspace_activity_events(workspace, page_size, before_created_at,
  before_id, search_term)` requires `activity.read`, searches descriptions
  case-insensitively and returns `{events, has_more, next_cursor}` using keyset
  pagination.
- `get_workspace_role(workspace, role)` requires `roles.read` and is used to
  open a role linked from an activity event.

Events are only logged for authenticated users, not service-role changes.

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
and the workspace list RPC applies the same check, so revoked workspaces
disappear from the picker.

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
The RPC-only suite verifies real anonymous/authenticated CRUD denials across all
public tables, column privileges, future-object defaults, and trusted-service
access. Legacy RLS tests deliberately restore table privileges inside their
rolled-back transactions to keep testing policies as defense in depth; other
legacy SQL suites grant transaction-only reads for fixture/persistence assertions.
These grants are never applied by migrations or retained after tests.

Run HTTP-level access, task mutation, and cursor-pagination checks with:

```powershell
npm run test:rpc
```

[Back to project documentation](../README.md)
