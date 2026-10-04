create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0)
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  description text not null default ''
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create index role_permissions_permission_id_idx
  on public.role_permissions (permission_id);

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;