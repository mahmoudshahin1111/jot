create or replace function public.list_workspace_activity_events(
  target_workspace_id uuid,
  page_size integer default 20,
  before_created_at timestamptz default null,
  before_id uuid default null,
  search_term text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_workspace_member(target_workspace_id) then
    raise exception 'You no longer have access to this workspace' using errcode = '42501';
  end if;
  if not private.has_workspace_permission(
    target_workspace_id,
    (select p.id from public.permissions p where p.key = 'activity.read')
  ) then
    raise exception 'You do not have permission to view workspace activity' using errcode = '42501';
  end if;
  if page_size is null or page_size < 1 or page_size > 100
    or ((before_created_at is null) <> (before_id is null)) then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;

  return (
    with page as (
      select e.id, e.event_type, e.description, e.actor_user_id, e.actor_name, e.created_at,
        e.affected_item_type, e.affected_item_id, e.affected_item_name, e.details
      from public.workspace_activity_events e
      where e.workspace_id = target_workspace_id
        and (coalesce(search_term, '') = '' or pg_catalog.strpos(pg_catalog.lower(e.description), pg_catalog.lower(pg_catalog.btrim(search_term))) > 0)
        and (before_created_at is null or (e.created_at, e.id) < (before_created_at, before_id))
      order by e.created_at desc, e.id desc
      limit page_size + 1
    )
    select jsonb_build_object(
      'events', coalesce((
        select jsonb_agg(to_jsonb(visible) order by visible.created_at desc, visible.id desc)
        from (select * from page order by created_at desc, id desc limit page_size) visible
      ), '[]'::jsonb),
      'total_count', (
        select count(*) from public.workspace_activity_events e
        where e.workspace_id = target_workspace_id
          and (coalesce(search_term, '') = '' or pg_catalog.strpos(pg_catalog.lower(e.description), pg_catalog.lower(pg_catalog.btrim(search_term))) > 0)
      ),
      'has_more', (select count(*) > page_size from page),
      'next_cursor', (
        select jsonb_build_object('created_at', cursor_row.created_at, 'id', cursor_row.id)
        from (select * from page order by created_at desc, id desc limit page_size) cursor_row
        order by cursor_row.created_at asc, cursor_row.id asc
        limit 1
      )
    )
  );
end;
$$;

revoke all on function public.list_workspace_activity_events(uuid, integer, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.list_workspace_activity_events(uuid, integer, timestamptz, uuid, text) to authenticated;
