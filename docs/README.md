# Local development

## Prerequisites

- Node.js 22.12 or later.
- npm.
- Docker Desktop with the Linux container engine running.

Run the commands below from the project root. The Supabase CLI is included in
the project dependencies.

## Setup

Install dependencies:

```powershell
npm ci
```

Start Supabase and apply local migrations:

```powershell
npx supabase start
npx supabase migration up --local
npx supabase status
```

Copy the environment template if needed:

```powershell
Copy-Item .env.example .env
```

Set the local Supabase URL and publishable key in `.env`, using the values
reported by `supabase status`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-local-publishable-key
```

Never put a secret or service-role key in a `VITE_*` variable; these values are
exposed to the browser. Keep `.env` uncommitted.

## Run the app

```powershell
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`. Restart Vite
after changing environment variables.

To use profile photo uploads, run the Edge Function in a second terminal:

```powershell
npx supabase functions serve profile-avatar
```

## Validate changes

```powershell
npm run build
npm run lint
npm run test:rpc
```

The RPC tests require local Supabase to be running. Other test commands are
listed in [package.json](../package.json).

## Stop local services

Stop Vite with `Ctrl+C`, then stop Supabase:

```powershell
npx supabase stop
```

See [Database and access control](./database.md) for database details and
[Deployment](./deployment.md) for deployment guidance.
