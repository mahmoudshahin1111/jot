# Local development

Shared development guidance belongs in
[Development principles](./development_principles.md), the single source of
truth for principles used across the project.

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
Supabase errors are displayed in the form. Email confirmation is enabled locally;
the page asks the user to check their inbox at `http://127.0.0.1:54324` (Mailpit).
Confirmation links return to the Vite app on port 5173. Task management UI is not
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
and a Settings group with Roles and permissions and Users. All workspaces remains
available at the bottom. A shared
[Breadcrumb component](../src/components/breadcrumb.tsx) shows the current
Workspace / group / page path on every workspace page. It accepts labeled items
with optional links and a navigation guard for reuse elsewhere. Sidebar groups
and breadcrumb paths come from the
[workspace navigation hook](../src/hooks/use-workspace-navigation.ts).
Sidebar pages are filtered by the authenticated user's current workspace
permissions. Roles and permissions and Users require `roles.read`; the Settings
group is hidden when neither page is available. Dashboard and Activity remain
available to any user with workspace access, since they have no separate page
permissions. Sidebar visibility updates when the workspace access check receives
role or permission changes. Hiding links does not replace direct-route, RPC,
or database authorization.
Direct links verify the session and workspace access; missing access
returns the user to the workspace picker. On narrow screens the navigation
appears above the page. Leaving the roles page through the sidebar or breadcrumb prompts
before discarding unsaved permission edits.
The shared workspace header contains breadcrumbs and a Log out button on
Dashboard, Activity, and Roles and permissions. Logging out honors the same
unsaved-permission guard, disables the button while signing out, and redirects
to `/login` on success. Sign-out failures appear in the header if a session remains.
If Supabase clears the local session despite a server failure, the login page
displays that failure instead.

Roles and permissions is at `/workspaces/:workspaceId/settings/roles`. This page
uses live Supabase data rather than mock roles. It requires `roles.read` and
shows one row per seeded permission, with read-only system roles and editable
custom roles when the caller has `roles.update`. Unsaved edits show Save and
Discard actions; saving persists the entire selection atomically.
Non-owners cannot edit permissions on the role assigned to them, even with
`roles.update`; disabled checkboxes explain this restriction in a hover/focus
tooltip. Workspace owners may update other members' custom roles. System roles
remain read-only for everyone. The save RPC enforces the self-role restriction.
Roles and members load ten rows at a time with automatic infinite scrolling
and a Load more fallback. Roles and permissions use `name` for human-readable
display (Owner, Editor, Viewer, or a custom name) and `key` for machine-readable
identifiers such as `workspace.owner` and `tasks.read`.
Client-side permission checks use the shared
[`PERMISSIONS` constant](../src/lib/permissions.ts), for example
`PERMISSIONS.roles.update`, rather than inline permission keys. It lists all
seeded task and role permissions and exports a `PermissionKey` literal-union
type. Keep this list aligned with permission definitions in the database seed;
display names and assigned permissions still come from Supabase.
The shared [`useWorkspacePermissions` hook](../src/hooks/use-workspace-permissions.ts)
exposes only `hasPermission(permission)`, which returns a boolean. Roles group
permissions; consumers check the permission needed for an action, not role names.
Pages and role actions retain contextual constraints such as system roles,
assigned members, and the own-role editing restriction.
The separate [`workspace access hook`](../src/hooks/use-workspace-access.ts)
initializes access for the signed-in user when a workspace opens
and owns the single workspace-access realtime subscription, auth events, focus
refreshes, retries, and cleanup. Permissions are workspace-scoped, so they are
loaded after login once the workspace is known, not globally at login.
The workspace shell handles navigation and logout; pages and components own
button visibility, disabled states, and explanatory messages.
Filtering searches names across all available roles, not just
the loaded page. Duplication copies saved permissions into a custom role
without members. Member removal revokes that workspace membership and updates
the visible list without reloading it. Other workspaces and the user's Jot
session are preserved. Callers with `roles.delete` can select an empty custom
role and choose Delete role, then confirm, to remove it. System roles cannot be
deleted. Delete role is disabled for roles that still have members. A
hover/focus tooltip explains that all members must first be moved to another
role. The delete RPC enforces the same rule. If the visible member count was
stale, the page refreshes it and shows that message.
Create role opens an accessible name-entry modal for callers with `roles.create`.
Enter or Create role saves the trimmed, non-empty name and selects the new
custom role's permissions editor. New roles start without permissions or members.
Apply the creation and assignment migrations alongside the frontend. Add members
opens a searchable, paginated picker of existing workspace users for callers
with `roles.members.add`. Adding a user replaces their previous workspace role.
Only owners can reassign owners or themselves; the last owner cannot be moved.
Email invitations are managed separately on the Users page.

### Users and email invitations

Open `/workspaces/:workspaceId/settings/users`. It uses the same two-card layout
as Roles and permissions, with workspace users and a separate Invitations list.
Viewing users requires `roles.read`; sending invitations requires `roles.members.add`.
Only workspace owners can invite someone to the Owner role. Removing workspace
users requires `roles.members.remove` and preserves the existing last-owner protection.

Run the invitation Edge Function in a second terminal:

```powershell
npx supabase functions serve invite-workspace-user
```

Invite user accepts an email and a workspace role. Supabase sends a confirmation
or magic-link email to either a new account or an existing account, including
someone who already belongs to another workspace. The email opens
`/invitations/accept?id=...`. Only the confirmed invited email can review and
accept; signing in alone does not create a workspace membership.
Acceptance preserves all other workspaces and never replaces an existing role.
New email-link accounts can choose **Sign in with email link** on the login page
for later visits; no password is assigned by the invitation flow. Password
sign-in remains available for existing accounts.

Each sender can have at most **10 pending invitations across all workspaces**.
The server serializes concurrent requests to enforce this limit. The Invitations
list shows that sender's pending invitations globally, including the workspace
and role. Acceptance, removal, or expiry after seven days frees a slot. Removing
an invitation invalidates its link; it does not delete the recipient's account.
Failed email delivery cancels the reservation and reports an error.
Private Realtime notifications automatically refresh the sender's list when an
invitation is accepted, removed, or delivered. Use Refresh or refocus the page to
check expirations or recover if live updates are unavailable.

Local emails stay in Mailpit and are not sent to real inboxes. The local
`APP_URL` default for the Edge Function is `http://localhost:5173`. To use another
origin, set `APP_URL` in an uncommitted Edge Function environment file, pass it
with `supabase functions serve --env-file`, and update the Auth site URL and
allowed redirects accordingly. Hosted deployment also needs the migration,
the deployed Edge Function, `APP_URL`, matching Auth redirect URLs, and a real
SMTP provider. Service-role credentials are used only inside the Edge Function,
never in the frontend.

Invitation integration tests use Node's built-in runner against local Supabase:

```powershell
npm run test:invitations
```

The runnable Playwright browser flow uses isolated sender/recipient contexts and
tests the exact 10-invitation limit, removal, email delivery, acceptance, and
retention of another workspace. With an existing Playwright installation, point
`PLAYWRIGHT_MODULE` to its `index.mjs` (omit this if `playwright` is importable):

```powershell
$env:PLAYWRIGHT_MODULE = 'C:\path\to\playwright\index.mjs'
npm run test:invitations:browser
```

The roles browser flow uses the same setup. It checks that roles with members
have Delete role disabled and show the explanatory tooltip on hover. It also
checks that empty custom roles can be deleted, and that a stale member count is
refreshed when the server rejects a deletion:

```powershell
npm run test:roles:browser
```

Start Vite and the Edge Function first. On Windows, the browser test uses installed
Microsoft Edge; elsewhere, it uses Playwright Chromium. Test fixtures have unique
emails and are removed afterward, including their specific Mailpit messages.
The transactional SQL regression checks in
[`workspace_role_management.sql`](../supabase/tests/workspace_role_management.sql)
run against local Supabase without leaving fixture users, workspaces, or roles:

```powershell
Get-Content supabase\tests\workspace_role_management.sql -Raw | docker exec -i supabase_db_Jot psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

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
$tests = Get-ChildItem supabase\tests\*.test.sql | ForEach-Object { $_.FullName }
npx supabase test db $tests
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
