begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table activity_fixture (name text primary key, id uuid not null);
grant select, insert on activity_fixture to authenticated;
insert into activity_fixture select name, gen_random_uuid()
from unnest(array['workspace', 'other_workspace', 'owner', 'viewer', 'outsider']) name;
create function pg_temp.f(n text) returns uuid language sql as $$
  select id from activity_fixture where name = n;
$$;
insert into auth.users (id) values (pg_temp.f('owner')), (pg_temp.f('viewer')), (pg_temp.f('outsider'));
insert into public.workspaces (id, name) values
  (pg_temp.f('workspace'), 'Activity test'), (pg_temp.f('other_workspace'), 'Other workspace');
insert into public.workspace_users (workspace_id, user_id, role_id)
select pg_temp.f('workspace'), pg_temp.f('owner'), id from public.roles where is_system and key = 'workspace.owner'
union all
select pg_temp.f('workspace'), pg_temp.f('viewer'), id from public.roles where is_system and key = 'workspace.viewer';

select is(
  (select count(*)::integer from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    join public.permissions p on p.id = rp.permission_id
   where p.key = 'activity.read' and r.is_system and r.key <> 'workspace.owner'),
  0, 'Only the owner role has activity.read by default'
);

select set_config('request.jwt.claim.sub', pg_temp.f('owner')::text, true);
set local role authenticated;
insert into activity_fixture values ('custom', (public.create_workspace_role(pg_temp.f('workspace'), 'Auditors')->>'id')::uuid);
insert into public.tasks (workspace_id, title) values (pg_temp.f('workspace'), 'Write the release notes');

select is(
  jsonb_array_length(public.list_workspace_activity_events(pg_temp.f('workspace'))->'events'),
  2, 'Role and task creation are logged'
);
select is(
  (select e->>'actor_name' is not null and e->>'affected_item_name' = 'Write the release notes'
   from jsonb_array_elements(public.list_workspace_activity_events(pg_temp.f('workspace'))->'events') e
   where e->>'event_type' = 'task.created'),
  true, 'Task event stores the actor and item name'
);
select is(
  (select e->>'affected_item_id' from jsonb_array_elements(public.list_workspace_activity_events(pg_temp.f('workspace'))->'events') e
   where e->>'event_type' = 'role.created'),
  pg_temp.f('custom')::text, 'Role event links to the created role'
);
select is(
  jsonb_array_length(public.list_workspace_activity_events(pg_temp.f('workspace'), 20, null, null, 'RELEASE')->'events'),
  1, 'Search matches descriptions case insensitively'
);
select is(
  jsonb_array_length(public.list_workspace_activity_events(pg_temp.f('workspace'), 20, null, null, 'nothing-like-this')->'events'),
  0, 'Search without matches returns no events'
);
select is(
  public.list_workspace_activity_events(pg_temp.f('workspace'), 1)->>'has_more',
  'true', 'Pagination reports more events'
);
select is(
  jsonb_array_length(public.list_workspace_activity_events(
    pg_temp.f('workspace'), 1,
    (public.list_workspace_activity_events(pg_temp.f('workspace'), 1)->'next_cursor'->>'created_at')::timestamptz,
    (public.list_workspace_activity_events(pg_temp.f('workspace'), 1)->'next_cursor'->>'id')::uuid
  )->'events'),
  1, 'Cursor returns the next page'
);

delete from public.tasks where workspace_id = pg_temp.f('workspace');
select is(
  (select count(*)::integer from jsonb_array_elements(public.list_workspace_activity_events(pg_temp.f('workspace'))->'events') e
   where e->>'event_type' = 'task.created' and e->>'affected_item_name' = 'Write the release notes'),
  1, 'Events survive deletion of the affected task'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.list_workspace_activity_events(pg_temp.f('workspace'))->'events') e
   where e->>'event_type' = 'task.deleted'),
  1, 'Task deletion is logged'
);

select set_config('request.jwt.claim.sub', pg_temp.f('viewer')::text, true);
select throws_ok(
  $$select public.list_workspace_activity_events(pg_temp.f('workspace'))$$,
  '42501', null, 'Members without activity.read are rejected'
);
select set_config('request.jwt.claim.sub', pg_temp.f('outsider')::text, true);
select throws_ok(
  $$select public.list_workspace_activity_events(pg_temp.f('workspace'))$$,
  '42501', null, 'Non-members are rejected'
);
select throws_ok(
  $$select * from public.workspace_activity_events$$,
  '42501', null, 'The events table cannot be read directly'
);

select * from finish();
rollback;
