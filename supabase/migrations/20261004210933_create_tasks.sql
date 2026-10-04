create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  created_at timestamptz not null default now()
);

alter table public.tasks enable row level security;