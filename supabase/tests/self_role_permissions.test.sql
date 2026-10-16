begin;
-- Transaction-only reads support legacy persistence assertions, not client access.
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table self_role_fixture (name text primary key, id uuid not null);
grant select on self_role_fixture to authenticated;
insert into self_role_fixture
select name, gen_random_uuid() from unnest(array['workspace', 'owner', 'manager', 'own_role', 'other_role']) name;
create function pg_temp.f(n text) returns uuid language sql as $$
  select id from self_role_fixture where name = n;
$$;
grant execute on function pg_temp.f(text) to authenticated;
insert into auth.users (id) values (pg_temp.f('owner')), (pg_temp.f('manager'));
insert into public.workspaces (id, name) values (pg_temp.f('workspace'), 'Self-role test');
insert into public.roles (id, key, name, workspace_id) values
  (pg_temp.f('own_role'), 'workspace.owner', 'Owner', pg_temp.f('workspace')),
  (pg_temp.f('other_role'), 'test.other', 'Other role', pg_temp.f('workspace'));
insert into public.role_permissions (role_id, permission_id)
select pg_temp.f('own_role'), id from public.permissions where key in ('roles.read', 'roles.update', 'tasks.read');
insert into public.workspace_users (workspace_id, user_id, role_id)
select pg_temp.f('workspace'), pg_temp.f('owner'), id from public.roles where is_system and key = 'workspace.owner'
union all
select pg_temp.f('workspace'), pg_temp.f('manager'), pg_temp.f('own_role');

select set_config('request.jwt.claim.sub', pg_temp.f('manager')::text, true);
set local role authenticated;
select is(public.get_workspace_access(pg_temp.f('workspace'))->>'role_id',
  pg_temp.f('own_role')::text, 'Access exposes the assigned role ID');
select is(public.get_workspace_access(pg_temp.f('workspace'))->>'is_owner',
  'false', 'Custom role named and keyed Owner is not workspace ownership');
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('own_role'),
    array[(select id from public.permissions where key = 'tasks.delete')],
    array(select permission_id from public.role_permissions where role_id = pg_temp.f('own_role')))$$,
  '42501', 'You cannot update a role assigned to you. Only the workspace owner can do this.',
  'Manager cannot grant permissions to their assigned role through a direct RPC'
);
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('own_role'),
    '{}'::uuid[], array(select permission_id from public.role_permissions where role_id = pg_temp.f('own_role')))$$,
  '42501', 'You cannot update a role assigned to you. Only the workspace owner can do this.',
  'Manager cannot revoke their own assigned permissions either'
);
select is((select count(*) from public.role_permissions where role_id = pg_temp.f('own_role')),
  3::bigint, 'Rejected self-role changes preserve mappings');
select lives_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('other_role'),
    array[(select id from public.permissions where key = 'tasks.read')], '{}'::uuid[])$$,
  'Manager with update permission can still edit a different role'
);
select set_config('request.jwt.claim.sub', pg_temp.f('owner')::text, true);
select is(public.get_workspace_access(pg_temp.f('workspace'))->>'is_owner',
  'true', 'System owner membership reports ownership');
select lives_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('own_role'),
    array[(select id from public.permissions where key = 'tasks.read')],
    array(select permission_id from public.role_permissions where role_id = pg_temp.f('own_role')))$$,
  'Workspace owner can edit the manager assigned custom role'
);
select is((select count(*) from public.role_permissions where role_id = pg_temp.f('own_role')),
  1::bigint, 'Owner changes persist');
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'),
    (select id from public.roles where is_system and key = 'workspace.owner'),
    '{}'::uuid[], '{}'::uuid[])$$,
  '42501', 'Only custom roles in this workspace can be updated',
  'Owner system role remains read-only'
);
reset role;
select * from finish();
rollback;
