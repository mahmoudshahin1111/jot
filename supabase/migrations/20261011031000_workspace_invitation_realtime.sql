create policy "Users receive their own invitation notifications"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() = 'workspace-invitations:' || (select auth.uid())::text
);

create function private.broadcast_workspace_invitation_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('invitation_id', old.id),
      'invitations_changed', 'workspace-invitations:' || old.invited_by::text, true);
  else
    perform realtime.send(jsonb_build_object('invitation_id', new.id),
      'invitations_changed', 'workspace-invitations:' || new.invited_by::text, true);
  end if;
  return null;
end;
$$;
revoke all on function private.broadcast_workspace_invitation_change() from public, anon, authenticated;

create trigger workspace_invitations_broadcast_change
after insert or update or delete on public.workspace_invitations
for each row execute function private.broadcast_workspace_invitation_change();
