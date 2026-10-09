create function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator_id uuid := auth.uid();
  owner_role_id uuid;
  new_workspace_id uuid;
begin
  if creator_id is null then
    raise exception 'You must sign in to create a workspace' using errcode = '42501';
  end if;
  if workspace_name is null or length(trim(workspace_name)) = 0 then
    raise exception 'Workspace name is required' using errcode = '22023';
  end if;
  select id into owner_role_id from public.roles
  where is_system and name = 'workspace.owner';
  if owner_role_id is null then
    raise exception 'Workspace owner role is not configured';
  end if;
  insert into public.workspaces (name) values (trim(workspace_name))
  returning id into new_workspace_id;
  insert into public.workspace_users (workspace_id, user_id, role_id)
  values (new_workspace_id, creator_id, owner_role_id);
  return new_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text) from public, anon, authenticated;
grant execute on function public.create_workspace(text) to authenticated;