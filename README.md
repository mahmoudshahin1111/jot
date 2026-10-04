# Jot

## Local database

Start local Supabase and apply pending migrations:

```powershell
npx supabase start
npx supabase migration up --local
```

The `public.tasks` table stores a generated UUID, a required non-empty title,
a description defaulting to an empty string, and a creation timestamp.
The `public.task_users` table links tasks to Supabase Auth users. Its composite
primary key prevents duplicate memberships, and a user index supports looking
up a user's tasks. Deleting a task or user removes its memberships; deleting a
user does not delete shared tasks.

Both tables have row-level security enabled. Authenticated users can read only
tasks linked to them through `task_users`, and only their own membership rows.
Each linked user can update the task. Users can delete only their own membership
to leave a task; the task and other users' memberships remain intact. Leaving
removes the user's read and update access. Even when the last user leaves, the
task is retained.

Anonymous access, browser task creation/deletion, and membership creation/updates
remain blocked. Additional policies will be added separately.

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
