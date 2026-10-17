create function public.count_workspace_task_summary(target_workspace_id uuid, search_term text default '')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_task_access(target_workspace_id, 'tasks.read');
  return (
    select jsonb_build_object(
      'all', count(*),
      'todo', count(*) filter (where t.status = 'todo'),
      'in_progress', count(*) filter (where t.status = 'in_progress'),
      'done', count(*) filter (where t.status = 'done')
    )
    from public.tasks t where t.workspace_id = target_workspace_id
      and (coalesce(search_term, '') = '' or strpos(lower(t.title), lower(search_term)) > 0
        or strpos(lower(t.description), lower(search_term)) > 0)
  );
end;
$$;

revoke all on function public.count_workspace_task_summary(uuid, text) from public, anon, authenticated;
grant execute on function public.count_workspace_task_summary(uuid, text) to authenticated;
