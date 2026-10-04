alter table public.roles
add column is_system boolean not null default false;