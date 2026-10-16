begin;

-- Exercise RLS as defense in depth if table grants are accidentally restored.
-- Production grant denial is verified separately in rpc_only_access.test.sql.
grant select, insert, update, delete on all tables in schema public to authenticated, anon;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table fixture_ids (name text primary key, id uuid not null);
grant select on fixture_ids to authenticated, anon;
insert into fixture_ids (name, id)
select name, gen_random_uuid()
from unnest(array[
  'workspace_a', 'workspace_b', 'workspace_c',
  'owner', 'editor', 'viewer', 'outsider', 'custom_member',
  'task_a', 'task_b', 'task_c', 'custom_role_b', 'custom_role_c'
]) as name;

create function pg_temp.fixture_id(fixture_name text)
returns uuid language sql as $$
  select id from fixture_ids where name = fixture_name;
$$;
grant execute on function pg_temp.fixture_id(text) to authenticated, anon;

insert into auth.users (id)
select id from fixture_ids where name in ('owner', 'editor', 'viewer', 'outsider', 'custom_member');

insert into public.workspaces (id, name)
select id, name from fixture_ids where name like 'workspace_%';

insert into public.tasks (id, title, workspace_id)
values
  (pg_temp.fixture_id('task_a'), 'Task A', pg_temp.fixture_id('workspace_a')),
  (pg_temp.fixture_id('task_b'), 'Task B', pg_temp.fixture_id('workspace_b')),
  (pg_temp.fixture_id('task_c'), 'Task C', pg_temp.fixture_id('workspace_c'));

insert into public.roles (id, key, name, workspace_id)
values
  (pg_temp.fixture_id('custom_role_b'), 'custom.reader', 'Custom reader', pg_temp.fixture_id('workspace_b')),
  (pg_temp.fixture_id('custom_role_c'), 'custom.reader', 'Custom reader', pg_temp.fixture_id('workspace_c'));

insert into public.role_permissions (role_id, permission_id)
select pg_temp.fixture_id('custom_role_b'), id from public.permissions where key = 'tasks.read';

insert into public.workspace_users (workspace_id, user_id, role_id)
select pg_temp.fixture_id('workspace_a'), pg_temp.fixture_id('owner'), id
from public.roles where is_system and key = 'workspace.owner'
union all
select pg_temp.fixture_id('workspace_b'), pg_temp.fixture_id('owner'), id
from public.roles where is_system and key = 'workspace.owner'
union all
select pg_temp.fixture_id('workspace_a'), pg_temp.fixture_id('editor'), id
from public.roles where is_system and key = 'workspace.editor'
union all
select pg_temp.fixture_id('workspace_a'), pg_temp.fixture_id('viewer'), id
from public.roles where is_system and key = 'workspace.viewer'
union all
select pg_temp.fixture_id('workspace_b'), pg_temp.fixture_id('custom_member'), pg_temp.fixture_id('custom_role_b')
union all
select pg_temp.fixture_id('workspace_c'), pg_temp.fixture_id('outsider'), pg_temp.fixture_id('custom_role_c');

select throws_ok(
  $$insert into public.workspace_users values (
    pg_temp.fixture_id('workspace_a'), pg_temp.fixture_id('custom_member'), pg_temp.fixture_id('custom_role_b')
  )$$, '23514', 'Role must be a system role or belong to the same workspace',
  'A workspace cannot use another workspace custom role'
);

select throws_ok(
  $$update public.roles set workspace_id = pg_temp.fixture_id('workspace_a')
    where id = pg_temp.fixture_id('custom_role_b')$$,
  '23514', 'Role scope cannot be changed; create a new role instead',
  'Assigned custom roles cannot be moved across workspaces'
);

select throws_ok(
  $$insert into public.roles (key, name) values ('unscoped.custom', 'Unscoped custom')$$,
  '23514', null, 'Custom roles require a workspace'
);

select throws_ok(
  $$insert into public.roles (key, name, is_system, workspace_id)
    values ('scoped.system', 'Scoped system', true, pg_temp.fixture_id('workspace_a'))$$,
  '23514', null, 'System roles must be global'
);

select is(
  (select count(*) from public.roles where key = 'custom.reader'),
  2::bigint, 'Different workspaces can reuse custom role names'
);

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('editor')::text, true);
set local role authenticated;

select is(
  (select count(*) from public.tasks where id in (select id from fixture_ids)),
  1::bigint, 'Editor sees only their workspace tasks'
);
select is(
  (select count(*) from public.workspaces where id in (select id from fixture_ids)),
  1::bigint, 'Editor sees only their workspace'
);
select is(
  (select count(*) from public.workspace_users where workspace_id in (select id from fixture_ids)),
  1::bigint, 'Editor sees only their own membership'
);
with changed as (
    update public.tasks set title = 'Edited', description = 'Editor update'
    where id = pg_temp.fixture_id('task_a') returning id
)
select is(
  (select count(*) from changed),
  1::bigint, 'Editor can update workspace tasks'
);
with changed as (
    update public.tasks set title = 'Forbidden'
    where id = pg_temp.fixture_id('task_b') returning id
)
select is(
  (select count(*) from changed),
  0::bigint, 'Editor cannot update another workspace task'
);
with deleted as (
    delete from public.tasks where id = pg_temp.fixture_id('task_a') returning id
)
select is(
  (select count(*) from deleted),
  0::bigint, 'Editor cannot delete tasks'
);
select is(
  (select count(*) from public.roles where id in (
    pg_temp.fixture_id('custom_role_b'), pg_temp.fixture_id('custom_role_c')
  )),
  0::bigint, 'Editor cannot see other workspace custom roles'
);
with changed as (
    update public.workspace_users
    set role_id = (select id from public.roles where is_system and key = 'workspace.owner')
    where user_id = pg_temp.fixture_id('editor') returning user_id
)
select is(
  (select count(*) from changed),
  0::bigint, 'Editor cannot promote themselves'
);
with deleted as (
    delete from public.workspace_users where user_id = pg_temp.fixture_id('editor') returning user_id
)
select is(
  (select count(*) from deleted),
  0::bigint, 'Client membership deletion remains blocked'
);
with changed as (
    update public.roles set key = 'Tampered' where is_system returning id
)
select is(
  (select count(*) from changed),
  0::bigint, 'System role edits remain blocked'
);
select throws_ok(
  $$insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r cross join public.permissions p
    where r.is_system and r.key = 'workspace.editor' and p.key = 'tasks.delete'$$,
  '42501', null, 'Editor cannot grant themselves delete permission'
);
select set_config('request.jwt.claim.sub', pg_temp.fixture_id('viewer')::text, true);
select throws_ok(
  $$insert into public.tasks (title, workspace_id)
    values ('Forbidden create', pg_temp.fixture_id('workspace_a'))$$,
  '42501', null, 'Viewer task creation remains blocked'
);

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('viewer')::text, true);
select is(
  (select count(*) from public.tasks where id = pg_temp.fixture_id('task_a') and title = 'Edited'),
  1::bigint, 'Viewer sees task and shared edits'
);
with changed as (
    update public.tasks set title = 'Forbidden' where id = pg_temp.fixture_id('task_a') returning id
)
select is(
  (select count(*) from changed),
  0::bigint, 'Viewer cannot update tasks'
);
with deleted as (
    delete from public.tasks where id = pg_temp.fixture_id('task_a') returning id
)
select is(
  (select count(*) from deleted),
  0::bigint, 'Viewer cannot delete tasks'
);

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('custom_member')::text, true);
select is(
  (select count(*) from public.tasks where id in (select id from fixture_ids)),
  1::bigint, 'Custom role grants access only within its workspace'
);
select is(
  (select count(*) from public.roles where id = pg_temp.fixture_id('custom_role_b')),
  1::bigint, 'Members can see their workspace custom roles'
);
select is(
  (select count(*) from public.role_permissions where role_id = pg_temp.fixture_id('custom_role_b')),
  1::bigint, 'Members can see their custom role permission mappings'
);
with changed as (
    update public.tasks set title = 'Forbidden' where id = pg_temp.fixture_id('task_b') returning id
)
select is(
  (select count(*) from changed),
  0::bigint, 'Custom reader cannot update tasks'
);

reset role;
delete from public.role_permissions where role_id = pg_temp.fixture_id('custom_role_b');
set local role authenticated;
select is(
  (select count(*) from public.tasks where id = pg_temp.fixture_id('task_b')),
  0::bigint, 'Revoking a permission immediately removes task access'
);

select set_config('request.jwt.claim.sub', pg_temp.fixture_id('owner')::text, true);
select throws_ok(
  $$update public.tasks set workspace_id = pg_temp.fixture_id('workspace_b')
    where id = pg_temp.fixture_id('task_a')$$,
  '23514', 'Tasks cannot be moved between workspaces',
  'Even members of both workspaces cannot move tasks between them'
);
with deleted as (
    delete from public.tasks where id = pg_temp.fixture_id('task_a') returning id
)
select is(
  (select count(*) from deleted),
  1::bigint, 'Owner can delete workspace tasks'
);

reset role;
delete from public.workspace_users where user_id = pg_temp.fixture_id('owner');
set local role authenticated;
select is(
  (select count(*) from public.tasks where id in (select id from fixture_ids)),
  0::bigint, 'Removing membership immediately revokes owner access'
);
with deleted as (
    delete from public.tasks where id = pg_temp.fixture_id('task_b') returning id
)
select is(
  (select count(*) from deleted),
  0::bigint, 'Former owner cannot delete tasks'
);

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select is((select count(*) from public.tasks), 0::bigint, 'Anonymous users cannot read tasks');
select is((select count(*) from public.workspaces), 0::bigint, 'Anonymous users cannot read workspaces');
select is((select count(*) from public.roles), 0::bigint, 'Anonymous users cannot read roles');
with deleted as (
    delete from public.tasks where id = pg_temp.fixture_id('task_b') returning id
)
select is(
  (select count(*) from deleted),
  0::bigint, 'Anonymous users cannot delete tasks'
);

reset role;
delete from public.workspaces where id = pg_temp.fixture_id('workspace_c');
select is(
  (select count(*) from public.tasks where id = pg_temp.fixture_id('task_c')),
  0::bigint, 'Workspace deletion cascades to tasks'
);
select is(
  (select count(*) from public.workspace_users where workspace_id = pg_temp.fixture_id('workspace_c')),
  0::bigint, 'Workspace deletion cascades to memberships'
);
select is(
  (select count(*) from public.roles where id = pg_temp.fixture_id('custom_role_c')),
  0::bigint, 'Workspace deletion cascades to referenced custom roles'
);
select is(
  (select count(*) from public.roles where is_system and key like 'workspace.%'),
  3::bigint, 'Workspace deletion preserves shared system roles'
);
delete from auth.users where id = pg_temp.fixture_id('custom_member');
select is(
  (select count(*) from public.workspace_users where user_id = pg_temp.fixture_id('custom_member')),
  0::bigint, 'User deletion removes workspace memberships'
);
select is(
  (select count(*) from public.tasks where id = pg_temp.fixture_id('task_b')),
  1::bigint, 'User deletion preserves workspace tasks'
);

select * from finish();
rollback;
