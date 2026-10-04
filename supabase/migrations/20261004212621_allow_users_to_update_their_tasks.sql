create policy "Users can update their tasks"
on public.tasks
for update
to authenticated
using (
  exists (
    select 1
    from public.task_users
    where task_users.task_id = tasks.id
      and task_users.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.task_users
    where task_users.task_id = tasks.id
      and task_users.user_id = (select auth.uid())
  )
);