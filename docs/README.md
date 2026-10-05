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
VITE_SUPABASE_ANON_KEY=your-local-anon-key
```

The current client reads `VITE_SUPABASE_ANON_KEY`, not
`VITE_SUPABASE_PUBLISHABLE_KEY`. Use the local anon key reported by Supabase.
Never place a secret or service-role key in a `VITE_*` variable; Vite exposes
these variables to the browser. Keep `.env` uncommitted.

## 4. Run React

```powershell
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.
Restart Vite after changing environment variables.

The frontend currently uses the starter screen. Signup, workspace onboarding,
and task management UI are not implemented yet.

## UI components

The project uses shadcn/ui with the Base Nova preset (Base UI primitives),
Tailwind CSS v4, a neutral theme, and Lucide icons. Configuration is in
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
The starter screen retains its separate system-color-scheme styles.

## Validation
```powershell
npm run build
npm run lint
npx supabase test db
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
