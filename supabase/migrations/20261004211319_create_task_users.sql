create table public.task_users (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, user_id)
);

create index task_users_user_id_idx on public.task_users (user_id);

alter table public.task_users enable row level security;