do $$
begin
  if exists (
    select 1 from public.workspaces
    where id = '00000000-0000-4000-8000-000000000001'
      and name = 'Initial workspace'
  ) then
    if exists (
      select 1 from public.tasks
      where workspace_id = '00000000-0000-4000-8000-000000000001'
    ) or exists (
      select 1 from public.workspace_users
      where workspace_id = '00000000-0000-4000-8000-000000000001'
    ) or exists (
      select 1 from public.roles
      where workspace_id = '00000000-0000-4000-8000-000000000001'
    ) then
      raise exception 'Initial workspace contains data; migrate it explicitly before removing the workspace';
    end if;

    delete from public.workspaces
    where id = '00000000-0000-4000-8000-000000000001'
      and name = 'Initial workspace';
  end if;
end;
$$;