# Jot

## Local database

Start local Supabase and apply pending migrations:

```powershell
npx supabase start
npx supabase migration up --local
```

The `public.workspaces` table stores a generated UUID, a required non-empty name,
and a creation timestamp. The `public.workspace_users` table links Supabase Auth
users to workspaces, with one `role_id` per membership and a composite primary
key of `(workspace_id, user_id)`.

Each `public.tasks` row belongs to a workspace through its required
`workspace_id`. It also has a generated UUID, a required non-empty title,
a description defaulting to an empty string, and a creation timestamp.
Tasks cannot be moved between workspaces.

No root or default workspace is created by migrations or seeds. Signup
onboarding will require a user to create at least one workspace before
continuing; that flow is not implemented yet.

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

Anonymous access and client task creation remain blocked. Workspace,
membership, role, and permission management must currently use a trusted
administrative connection. Leaving individual tasks is no longer supported;
workspace membership management and automatic owner assignment will be added
separately.

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

The migration and configured `supabase/seed.sql` install the following shared
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

## React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
