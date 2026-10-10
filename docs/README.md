# Local development

## Prerequisites

- Node.js 22.12 or later in the 22.x line, or a newer supported LTS release
  (Node.js 24 is used for current development).
- npm, included with Node.js.
- Docker Desktop with the Linux container engine running.

Run all commands below from the project root. The Supabase CLI is included as
a development dependency; a global installation is not required.

## 1. Install dependencies

```powershell
npm ci
```

## 2. Start local Supabase

```powershell
npx supabase start
npx supabase migration up --local
npx supabase status
```

The first start downloads container images and may take several minutes.
Use the URLs reported by `supabase status` to access the API and Supabase Studio.
The default Studio address is `http://127.0.0.1:54323`.

Migrations create the database structure and built-in roles and permissions.
No default workspace or membership is created. See
[Database and access control](./database.md) for current access restrictions.

## 3. Configure the React environment

If you do not already have a `.env` file, copy the template:

```powershell
Copy-Item .env.example .env
```

Set these values in `.env` using your local Supabase status output:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-local-publishable-key
```

The client reads `VITE_SUPABASE_PUBLISHABLE_KEY`. Use the publishable key
from your Supabase project, or the local key reported by `supabase status`.
Never place a secret or service-role key in a `VITE_*` variable; Vite exposes
these variables to the browser. Keep `.env` uncommitted.

## 4. Run React

```powershell
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.
Restart Vite after changing environment variables.

The frontend shows an email/password signup page using shadcn components,
React Hook Form, and Zod. Password confirmation must match; the minimum password
length is six characters, matching the current local Supabase configuration.
Supabase errors are displayed in the form. If email confirmation is enabled,
the page asks the user to check their inbox (Mailpit for local development).
Otherwise it continues to the workspace check. Task management UI is not
implemented yet.

The login page is available at `/login`, with signup at `/signup`. The root
URL redirects to signup. React Router handles client-side navigation.
Both pages link to each other and share the shadcn layout.
Login uses React Hook Form and Zod to validate email and a non-empty password,
then calls Supabase password sign-in. Errors appear in the form. Successful
login goes to `/workspaces`, which queries Supabase for the authenticated user's
workspaces under RLS. Users without memberships are redirected to
`/workspaces/new`; users with memberships see their workspace list.
The creation page validates the name and calls `create_workspace`, creating
the workspace and assigning the creator `workspace.owner` atomically.
Both workspace pages require a session, and loading errors offer a retry
instead of being treated as an empty workspace list.
Opening `/workspaces/:workspaceId` redirects to its empty Dashboard page at
`/workspaces/:workspaceId/dashboard`. The shared sidebar has an Overview group
with Dashboard and Activity (`/workspaces/:workspaceId/activity`, also empty),
and a Settings group with Roles and permissions. All workspaces remains
available at the bottom. A shared
[Breadcrumb component](../src/components/breadcrumb.tsx) shows the current
Workspace / group / page path on every workspace page. It accepts labeled items
with optional links and a navigation guard for reuse elsewhere. Sidebar groups
and breadcrumb paths come from the
[workspace navigation hook](../src/hooks/use-workspace-navigation.ts).
Direct links verify the session and workspace access; missing access
returns the user to the workspace picker. On narrow screens the navigation
appears above the page. Leaving the roles page through the sidebar or breadcrumb prompts
before discarding unsaved permission edits.

Roles and permissions is at `/workspaces/:workspaceId/settings/roles`. This page
uses live Supabase data rather than mock roles. It requires `roles.read` and
shows one row per seeded permission, with read-only system roles and editable
custom roles when the caller has `roles.update`. Unsaved edits show Save and
Discard actions; saving persists the entire selection atomically.
Roles and members load ten rows at a time with automatic infinite scrolling
and a Load more fallback. Roles and permissions use `name` for human-readable
display (Owner, Editor, Viewer, or a custom name) and `key` for machine-readable
identifiers such as `workspace.owner` and `tasks.read`.
Filtering searches names across all available roles, not just
the loaded page. Duplication copies saved permissions into a custom role
without members. Member removal revokes that workspace membership and updates
the visible list without reloading it. Other workspaces and the user's Jot
session are preserved. Empty custom roles can be deleted; system roles cannot.
Create role and Add members are disabled placeholders for later tickets.
The workspace shell subscribes to private Supabase Realtime broadcasts over
WebSockets. Membership changes and changes to the user's assigned role permissions
trigger an authorized access check, without periodic polling. Access is also
checked on navigation, focus, and subscription reconnect. Removed users and users
whose role has no permissions return to the workspace picker without signing out;
losing only `roles.read` returns users to Dashboard. Role capabilities refresh
after access notifications. Connection failures display an error with a retry.
Supabase enforces access immediately on RPCs and RLS-protected queries.
Production frontend hosting must serve `index.html` for application routes
such as `/login` and `/signup` so direct links and refreshes work.

## UI components

The project uses shadcn/ui with the Base Nova preset (Base UI primitives),
Tailwind CSS v4, a custom red/zinc theme, and Lucide icons. Configuration is in
[components.json](../components.json). The initial
[Button component](../src/components/ui/button.tsx) is installed.

Add components from the project root:

```powershell
npx shadcn add input card dialog
```

Import components using the configured `@/` alias:

```tsx
import { Button } from '@/components/ui/button'
```

Theme tokens are in [src/index.css](../src/index.css). Dark component styling
is activated by a `dark` class on an ancestor, typically the HTML element.
The floating bottom-right theme button switches between light and dark on all
pages and saves the preference in local storage. Light is the default.
The [useTheme hook](../src/hooks/use-theme.ts) owns theme state, persistence,
and the HTML class; the [toggle component](../src/components/theme-toggle.tsx)
uses the installed shadcn Button and Lucide sun/moon icons.
The theme uses the same semantic tokens for Tailwind utilities and shadcn.
Primary buttons use `bg-primary` and `hover:bg-primary-hover`; links use
`text-primary-text` for theme-specific contrast. Status utilities include
`text-success`, `text-warning`, and `text-info`. The installed Geist Variable
font supplies the sans-serif family; the mono family falls back to system fonts
when Geist Mono is unavailable. The neutral shadcn registry base remains selected
for generating components, while the CSS variables define the custom palette.

## Validation
```powershell
npm run build
npm run lint
npx supabase test db
```

Apply pending migrations to the local database before opening role management:

```powershell
npx supabase migration up --local
```

Database tests require local Supabase to be running and roll back their test data.

To preview the production frontend build locally:

```powershell
npm run build
npm run preview
```

The preview server is for local verification, not production hosting.

## Stop local services

Stop Vite with `Ctrl+C` in its terminal, then:

```powershell
npx supabase stop
```

Do not use `supabase db reset` to start the application: it deletes local
database data before reapplying migrations and the configured seed file.

[Back to project documentation](../README.md)
