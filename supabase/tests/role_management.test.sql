begin;
-- Transaction-only reads support legacy persistence assertions, not client access.
grant select on public.roles, public.role_permissions to authenticated;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table management_fixture (name text primary key, id uuid not null);
grant select, insert on management_fixture to authenticated;
insert into management_fixture select name, gen_random_uuid()
from unnest(array['workspace', 'other_workspace', 'owner', 'viewer', 'custom', 'foreign_role']) name;
create function pg_temp.f(n text) returns uuid language sql as $$
  select id from management_fixture where name = n;
$$;
grant execute on function pg_temp.f(text) to authenticated;
insert into auth.users (id) values (pg_temp.f('owner')), (pg_temp.f('viewer'));
insert into public.workspaces (id, name) values
  (pg_temp.f('workspace'), 'Role management test'), (pg_temp.f('other_workspace'), 'Other workspace');
insert into public.roles (id, key, name, workspace_id) values
  (pg_temp.f('custom'), 'A custom test', 'A custom test', pg_temp.f('workspace')),
  (pg_temp.f('foreign_role'), 'Foreign test', 'Foreign test', pg_temp.f('other_workspace'));
insert into public.role_permissions (role_id, permission_id)
select pg_temp.f('custom'), id from public.permissions where key = 'tasks.read';
insert into public.workspace_users (workspace_id, user_id, role_id)
select pg_temp.f('workspace'), pg_temp.f('owner'), id from public.roles where is_system and key = 'workspace.owner'
union all
select pg_temp.f('workspace'), pg_temp.f('viewer'), pg_temp.f('custom');

select set_config('request.jwt.claim.sub', pg_temp.f('owner')::text, true);
set local role authenticated;
select is(
  public.count_workspace_roles(pg_temp.f('workspace'))::integer,
  4, 'List includes three system roles and workspace custom role only'
);
select is(
  jsonb_array_length(public.list_workspace_roles(pg_temp.f('workspace'), 1)->'roles'),
  2, 'List returns page size plus one for infinite scroll'
);
select is(
  public.list_workspace_roles(pg_temp.f('workspace'), 1)->'roles'->0->>'key',
  'A custom test', 'Role pagination uses stable name order'
);
select is(
  jsonb_array_length(public.list_workspace_roles(pg_temp.f('workspace'), 10, 'A custom test', pg_temp.f('custom'))->'roles'),
  3, 'Cursor excludes the already loaded role'
);
select is(
  public.count_workspace_roles(pg_temp.f('workspace'), 'CUSTOM')::integer,
  1, 'Filter searches role names case insensitively'
);
select throws_ok(
  $$select public.list_workspace_roles(pg_temp.f('workspace'), 0)$$,
  '22023', 'Invalid pagination parameters', 'Invalid page size is rejected'
);
select throws_ok(
  $$select public.list_workspace_roles(pg_temp.f('other_workspace'))$$,
  '42501', 'You no longer have access to this workspace', 'Cross-workspace list access is rejected'
);
insert into management_fixture values
  ('copy', public.duplicate_workspace_role(pg_temp.f('workspace'), pg_temp.f('custom')));
select is(
  (select key from public.roles where id = pg_temp.f('copy')),
  'A custom test (copy)', 'Duplicate receives a custom workspace name'
);
select is(
  (select count(*) from public.role_permissions where role_id = pg_temp.f('copy')),
  1::bigint, 'Duplicate copies the saved permissions'
);
select is(
  public.count_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('copy'))::integer,
  0, 'Duplicate does not assign members'
);
insert into management_fixture values
  ('copy2', public.duplicate_workspace_role(pg_temp.f('workspace'), pg_temp.f('custom')));
select is(
  (select key from public.roles where id = pg_temp.f('copy2')),
  'A custom test (copy 2)', 'Repeated duplication chooses a unique name'
);
select throws_ok(
  $$select public.duplicate_workspace_role(pg_temp.f('workspace'), pg_temp.f('foreign_role'))$$,
  '42501', 'Role is not available in this workspace', 'Cannot clone a foreign custom role'
);
select throws_ok(
  $$select public.delete_workspace_role(pg_temp.f('workspace'),
    (select id from public.roles where is_system and key = 'workspace.viewer'))$$,
  '42501', 'Only custom roles in this workspace can be deleted', 'System roles cannot be deleted'
);
select throws_ok(
  $$select public.delete_workspace_role(pg_temp.f('workspace'), pg_temp.f('custom'))$$,
  '23514', 'Remove all members before deleting this role', 'Populated roles cannot be deleted'
);
select lives_ok(
  $$select public.delete_workspace_role(pg_temp.f('workspace'), pg_temp.f('copy'))$$,
  'Empty custom role can be deleted'
);
select is(
  (select count(*) from public.roles where id = pg_temp.f('copy')),
  0::bigint, 'Deleted role is absent'
);
select set_config('request.jwt.claim.sub', pg_temp.f('viewer')::text, true);
select throws_ok(
  $$select public.list_workspace_roles(pg_temp.f('workspace'))$$,
  '42501', 'You do not have permission to perform this role action', 'Read permission is required'
);
select throws_ok(
  $$select public.duplicate_workspace_role(pg_temp.f('workspace'), pg_temp.f('custom'))$$,
  '42501', 'You do not have permission to perform this role action', 'Duplicate permission is required'
);
select throws_ok(
  $$select public.delete_workspace_role(pg_temp.f('workspace'), pg_temp.f('copy2'))$$,
  '42501', 'You do not have permission to perform this role action', 'Delete permission is required'
);
reset role;
select * from finish();
rollback;
