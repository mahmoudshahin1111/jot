alter table public.tasks
  add column status text not null default 'todo'
  check (status in ('todo', 'in_progress', 'done'));
