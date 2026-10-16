begin;
-- Transaction-only reads support legacy permission-ID lookups, not client access.
grant select on public.permissions to authenticated;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

select is(
  (select name from public.permissions where key = 'tasks.read'),
  'View tasks', 'Existing task permissions have display labels'
);
select is(
  (select name from public.permissions where key = 'roles.update'),
  'Update role permissions', 'Existing role permissions have display labels'
);
select throws_ok(
  $$insert into public.permissions (key, name) values ('test.blank', '   ')$$,
  '23514', null, 'Blank labels are rejected'
);
select throws_ok(
  $$insert into public.permissions (key, name) values ('test.null', null)$$,
  '23502', null, 'Null labels are rejected'
);

create temporary table label_fixture (user_id uuid, workspace_id uuid);
grant select, update on label_fixture to authenticated;
insert into label_fixture (user_id) values (gen_random_uuid());
insert into auth.users (id) select user_id from label_fixture;
select set_config('request.jwt.claim.sub', (select user_id::text from label_fixture), true);
set local role authenticated;
update label_fixture set workspace_id = public.create_workspace('Permission labels test');
select is(
  (select p->>'name'
    from jsonb_array_elements(public.list_workspace_roles(
      (select workspace_id from label_fixture)
    )->'permissions') p where p->>'key' = 'tasks.read'),
  'View tasks', 'Role listing RPC returns permission labels'
);
select ok(
  private.has_workspace_permission(
    (select workspace_id from label_fixture),
    (select id from public.permissions where key = 'tasks.read')
  ), 'Authorization still uses the unchanged machine key and permission ID'
);
reset role;
select * from finish();
rollback;
