create policy "Users can read their own task memberships"
on public.task_users
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Users can read their tasks"
on public.tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.task_users
    where task_users.task_id = tasks.id
      and task_users.user_id = (select auth.uid())
  )
);