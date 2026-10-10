begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table realtime_fixture (name text primary key, id uuid not null);
insert into realtime_fixture
select name, gen_random_uuid() from unnest(array['workspace', 'user', 'other', 'role', 'other_role']) name;
grant select on realtime_fixture to authenticated, anon;
create function pg_temp.realtime_id(name text) returns uuid language sql as $$
  select id from realtime_fixture where realtime_fixture.name = $1;
$$;

insert into auth.users (id) select id from realtime_fixture where name in ('user', 'other');
insert into public.workspaces (id, name) values (pg_temp.realtime_id('workspace'), 'Realtime access test');
insert into public.roles (id, name, label, workspace_id) values
  (pg_temp.realtime_id('role'), 'realtime-test', 'Realtime test', pg_temp.realtime_id('workspace')),
  (pg_temp.realtime_id('other_role'), 'realtime-other', 'Realtime other', pg_temp.realtime_id('workspace'));
insert into public.role_permissions (role_id, permission_id)
select pg_temp.realtime_id('role'), id from public.permissions where name = 'roles.read';
insert into public.workspace_users (workspace_id, user_id, role_id) values
  (pg_temp.realtime_id('workspace'), pg_temp.realtime_id('user'), pg_temp.realtime_id('role')),
  (pg_temp.realtime_id('workspace'), pg_temp.realtime_id('other'), pg_temp.realtime_id('other_role'));
delete from realtime.messages where topic in (
  'workspace-access:' || pg_temp.realtime_id('user'), 'workspace-access:' || pg_temp.realtime_id('other')
);

select set_config('request.jwt.claim.sub', pg_temp.realtime_id('user')::text, true);
set local role authenticated;
select is(public.get_workspace_access(pg_temp.realtime_id('workspace'))->>'role_id',
  pg_temp.realtime_id('role')::text, 'Access returns only the caller assigned role');
select is(public.get_workspace_access(pg_temp.realtime_id('workspace'))->'permissions',
  '["roles.read"]'::jsonb, 'Access returns current permission keys');
reset role;
select set_config('request.jwt.claim.sub', pg_temp.realtime_id('other')::text, true);
set local role authenticated;
select is(public.get_workspace_access(pg_temp.realtime_id('workspace')),
  null::jsonb, 'A role without permissions has no workspace access');
reset role;

delete from public.role_permissions where role_id = pg_temp.realtime_id('role');
select is((select count(*) from realtime.messages where topic = 'workspace-access:' || pg_temp.realtime_id('user')
  and event = 'access_changed' and private and payload->>'workspace_id' = pg_temp.realtime_id('workspace')::text),
  1::bigint, 'Permission deletion broadcasts to the assigned user');
select is((select count(*) from realtime.messages where topic = 'workspace-access:' || pg_temp.realtime_id('other')),
  0::bigint, 'Unassigned users receive no role-permission notification');

select set_config('request.jwt.claim.sub', pg_temp.realtime_id('user')::text, true);
select set_config('realtime.topic', 'workspace-access:' || pg_temp.realtime_id('user'), true);
set local role authenticated;
select is(public.get_workspace_access(pg_temp.realtime_id('workspace')),
  null::jsonb, 'Removing the last permission revokes access');
select is((select count(*) from public.workspaces where id = pg_temp.realtime_id('workspace')),
  0::bigint, 'Workspace picker and direct queries hide workspaces without permissions');
select is((select count(*) from realtime.messages where topic = 'workspace-access:' || pg_temp.realtime_id('user')),
  1::bigint, 'User can receive their notification after revocation');
reset role;
select set_config('request.jwt.claim.sub', pg_temp.realtime_id('other')::text, true);
set local role authenticated;
select is((select count(*) from realtime.messages where topic = 'workspace-access:' || pg_temp.realtime_id('user')),
  0::bigint, 'Other users cannot receive the user private topic');
reset role;

insert into public.role_permissions (role_id, permission_id)
select pg_temp.realtime_id('role'), id from public.permissions where name = 'tasks.read';
select is((select count(*) from realtime.messages where topic = 'workspace-access:' || pg_temp.realtime_id('user')),
  2::bigint, 'Permission insertion notifies the assigned user');
update public.workspace_users set role_id = pg_temp.realtime_id('other_role')
where user_id = pg_temp.realtime_id('user');
select is((select count(*) from realtime.messages where topic = 'workspace-access:' || pg_temp.realtime_id('user')),
  4::bigint, 'Role reassignment notifies the affected user');
delete from public.workspace_users where user_id = pg_temp.realtime_id('user');
select is((select count(*) from realtime.messages where topic = 'workspace-access:' || pg_temp.realtime_id('user')),
  5::bigint, 'Membership removal broadcasts after deletion');
set local role anon;
select throws_ok(
  $$select public.get_workspace_access(pg_temp.realtime_id('workspace'))$$,
  '42501', null, 'Anonymous access RPC calls are denied'
);
reset role;
select * from finish();
rollback;
