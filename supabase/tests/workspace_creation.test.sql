begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

create temporary table creation_fixture (user_id uuid, workspace_id uuid);
grant select, update on creation_fixture to authenticated;
insert into creation_fixture (user_id) values (gen_random_uuid());
insert into auth.users (id) select user_id from creation_fixture;
select set_config('request.jwt.claim.sub', (select user_id::text from creation_fixture), true);
set local role authenticated;

select throws_ok(
  $$select public.create_workspace('   ')$$,
  '22023', 'Workspace name is required', 'Blank workspace name is rejected'
);
select throws_ok(
  $$select public.create_workspace(null)$$,
  '22023', 'Workspace name is required', 'Null workspace name is rejected'
);
update creation_fixture set workspace_id = public.create_workspace('  Test workspace  ');
select is(
  (select name from public.workspaces where id = (select workspace_id from creation_fixture)),
  'Test workspace', 'Creator can read the workspace and name is trimmed'
);
select is(
  (select r.name from public.workspace_users u join public.roles r on r.id = u.role_id
   where u.workspace_id = (select workspace_id from creation_fixture)),
  'workspace.owner', 'Creator receives the system owner role'
);
select ok(
  private.has_workspace_permission(
    (select workspace_id from creation_fixture),
    (select id from public.permissions where name = 'tasks.delete')
  ), 'Creator receives owner permissions'
);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.create_workspace('Unauthorized')$$,
  '42501', 'You must sign in to create a workspace', 'Missing identity is rejected'
);
set local role anon;
select throws_ok(
  $$select public.create_workspace('Unauthorized')$$,
  '42501', null, 'Anonymous callers cannot execute creation'
);
reset role;
select * from finish();
rollback;
