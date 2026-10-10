create function public.get_workspace_access(target_workspace_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', w.id, 'name', w.name, 'role_id', u.role_id,
    'permissions', (
      select jsonb_agg(p.name order by p.name)
      from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = u.role_id
    )
  )
  from public.workspaces w
  join public.workspace_users u on u.workspace_id = w.id
  where w.id = target_workspace_id and u.user_id = (select auth.uid())
    and exists (select 1 from public.role_permissions rp where rp.role_id = u.role_id);
$$;

revoke all on function public.get_workspace_access(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_access(uuid) to authenticated;

alter policy "Members can read their workspaces" on public.workspaces
using (public.get_workspace_access(id) is not null);

create policy "Users receive their own workspace access notifications"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() = 'workspace-access:' || (select auth.uid())::text
);

create function private.broadcast_workspace_access_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  membership record;
begin
  if tg_table_name = 'workspace_users' then
    if tg_op <> 'INSERT' then
      perform realtime.send(
        jsonb_build_object('workspace_id', old.workspace_id),
        'access_changed', 'workspace-access:' || old.user_id::text, true
      );
    end if;
    if tg_op <> 'DELETE' then
      perform realtime.send(
        jsonb_build_object('workspace_id', new.workspace_id),
        'access_changed', 'workspace-access:' || new.user_id::text, true
      );
    end if;
  else
    for membership in
      select distinct u.workspace_id, u.user_id
      from public.workspace_users u
      where u.role_id in (
        case when tg_op <> 'INSERT' then old.role_id end,
        case when tg_op <> 'DELETE' then new.role_id end
      )
    loop
      perform realtime.send(
        jsonb_build_object('workspace_id', membership.workspace_id),
        'access_changed', 'workspace-access:' || membership.user_id::text, true
      );
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function private.broadcast_workspace_access_change() from public, anon, authenticated;

create trigger workspace_users_broadcast_access
after insert or update or delete on public.workspace_users
for each row execute function private.broadcast_workspace_access_change();

create trigger role_permissions_broadcast_access
after insert or update or delete on public.role_permissions
for each row execute function private.broadcast_workspace_access_change();
