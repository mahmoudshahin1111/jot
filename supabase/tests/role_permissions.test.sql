begin;
-- Transaction-only reads support legacy persistence assertions, not client access.
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table role_fixture (name text primary key, id uuid not null);
grant select on role_fixture to authenticated;
insert into role_fixture select name, gen_random_uuid()
from unnest(array['workspace', 'other_workspace', 'owner', 'viewer', 'custom', 'foreign_role']) name;
create function pg_temp.f(n text) returns uuid language sql as $$
  select id from role_fixture where name = n;
$$;
grant execute on function pg_temp.f(text) to authenticated;
insert into auth.users (id) values (pg_temp.f('owner')), (pg_temp.f('viewer'));
insert into public.workspaces (id, name) values
  (pg_temp.f('workspace'), 'Role permissions test'), (pg_temp.f('other_workspace'), 'Other workspace');
insert into public.roles (id, key, name, workspace_id) values
  (pg_temp.f('custom'), 'Custom test', 'Custom test', pg_temp.f('workspace')),
  (pg_temp.f('foreign_role'), 'Foreign test', 'Foreign test', pg_temp.f('other_workspace'));
insert into public.workspace_users (workspace_id, user_id, role_id)
select pg_temp.f('workspace'), pg_temp.f('owner'), id from public.roles where is_system and key = 'workspace.owner'
union all
select pg_temp.f('workspace'), pg_temp.f('viewer'), id from public.roles where is_system and key = 'workspace.viewer';

select set_config('request.jwt.claim.sub', pg_temp.f('owner')::text, true);
set local role authenticated;
select lives_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('custom'),
    array[(select id from public.permissions where key = 'tasks.read')], '{}'::uuid[])$$,
  'Workspace owner can save custom role permissions'
);
select is(
  (select count(*) from public.role_permissions where role_id = pg_temp.f('custom')),
  1::bigint, 'Permission changes persist'
);
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('custom'),
    '{}'::uuid[], '{}'::uuid[])$$,
  '40001', 'This role changed elsewhere. Reload it before saving.', 'Stale writes are rejected'
);
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'),
    (select id from public.roles where is_system and key = 'workspace.owner'),
    '{}'::uuid[], '{}'::uuid[])$$,
  '42501', 'Only custom roles in this workspace can be updated', 'System permissions are read-only'
);
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('foreign_role'),
    '{}'::uuid[], '{}'::uuid[])$$,
  '42501', 'Only custom roles in this workspace can be updated', 'Foreign workspace roles cannot be edited'
);
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('custom'),
    array[gen_random_uuid()], array[(select id from public.permissions where key = 'tasks.read')])$$,
  '22023', 'Invalid permission IDs', 'Unknown permissions are rejected'
);
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('custom'),
    array[null]::uuid[], array[(select id from public.permissions where key = 'tasks.read')])$$,
  '22023', 'Invalid permission IDs', 'Null permission IDs are rejected'
);
select is(
  (select count(*) from public.role_permissions where role_id = pg_temp.f('custom')),
  1::bigint, 'Rejected saves preserve existing permissions'
);
select lives_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('custom'),
    '{}'::uuid[], array[(select id from public.permissions where key = 'tasks.read')])$$,
  'Owner can explicitly clear permissions'
);
select is(
  (select count(*) from public.role_permissions where role_id = pg_temp.f('custom')),
  0::bigint, 'Empty permission selection persists'
);
select set_config('request.jwt.claim.sub', pg_temp.f('viewer')::text, true);
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('custom'),
    '{}'::uuid[], '{}'::uuid[])$$,
  '42501', 'You do not have permission to perform this role action', 'Membership alone cannot authorize saving'
);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.save_workspace_role_permissions(pg_temp.f('workspace'), pg_temp.f('custom'),
    '{}'::uuid[], '{}'::uuid[])$$,
  '42501', 'You no longer have access to this workspace', 'Missing identity is rejected'
);
reset role;
select * from finish();
rollback;
