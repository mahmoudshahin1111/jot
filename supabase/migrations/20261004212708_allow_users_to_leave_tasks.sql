create policy "Users can delete their own task memberships"
on public.task_users
for delete
to authenticated
using (user_id = (select auth.uid()));