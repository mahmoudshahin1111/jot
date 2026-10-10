begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_column('public', 'roles', 'key', 'Roles have a machine key');
select has_column('public', 'permissions', 'key', 'Permissions have a machine key');
select hasnt_column('public', 'roles', 'label', 'Roles no longer have a label column');
select hasnt_column('public', 'permissions', 'label', 'Permissions no longer have a label column');
select throws_ok(
  $$insert into public.permissions (key, name) values ('   ', 'Blank key')$$,
  '23514', null, 'Blank permission keys are rejected'
);
select throws_ok(
  $$insert into public.roles (key, name, is_system) values ('   ', 'Blank key', true)$$,
  '23514', null, 'Blank role keys are rejected'
);
select throws_ok(
  $$insert into public.permissions (key, name) values ('tasks.read', 'Duplicate key')$$,
  '23505', null, 'Permission keys remain unique'
);
select throws_ok(
  $$insert into public.roles (key, name, is_system) values ('workspace.owner', 'Duplicate key', true)$$,
  '23505', null, 'System role keys remain unique'
);
select lives_ok(
  $$insert into public.permissions (key, name) values ('test.shared-name', 'View tasks')$$,
  'Permission display names need not be unique'
);
select lives_ok(
  $$insert into public.roles (key, name, is_system) values ('test.shared-name', 'Owner', true)$$,
  'Role display names need not be unique'
);

create temporary table key_fixture (user_id uuid, workspace_id uuid);
grant select, update on key_fixture to authenticated;
insert into key_fixture (user_id) values (gen_random_uuid());
insert into auth.users (id) select user_id from key_fixture;
select set_config('request.jwt.claim.sub', (select user_id::text from key_fixture), true);
set local role authenticated;
update key_fixture set workspace_id = public.create_workspace('Keys test');
select ok(
  (public.list_workspace_roles((select workspace_id from key_fixture))->'roles'->0)
    ?& array['key', 'name'],
  'Role RPC rows contain both key and display name'
);
select ok(
  not ((public.list_workspace_roles((select workspace_id from key_fixture))->'roles'->0) ? 'label'),
  'Role RPC rows do not expose the old label field'
);
select ok(
  (public.list_workspace_roles((select workspace_id from key_fixture))->'permissions'->0)
    ?& array['key', 'name'],
  'Permission RPC rows contain both key and display name'
);
select ok(
  not ((public.list_workspace_roles((select workspace_id from key_fixture))->'permissions'->0) ? 'label'),
  'Permission RPC rows do not expose the old label field'
);
select is(
  public.list_workspace_roles(
    target_workspace_id => (select workspace_id from key_fixture),
    after_key => 'workspace.editor',
    after_id => (select id from public.roles where is_system and key = 'workspace.editor')
  )->'roles'->0->>'key',
  'workspace.owner', 'Named after_key cursor paginates by machine key rather than display name'
);
reset role;
select * from finish();
rollback;
