begin;
-- Transaction-only reads support legacy persistence assertions, not client access.
grant select on public.roles, public.permissions to authenticated;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select is(
  (select name from public.roles where is_system and key = 'workspace.owner'),
  'Owner', 'System roles have friendly display names'
);
select throws_ok(
  $$insert into public.roles (key, name, is_system) values ('test.blank', '   ', true)$$,
  '23514', null, 'Blank role names are rejected'
);
select throws_ok(
  $$insert into public.roles (key, name, is_system) values ('test.null', null, true)$$,
  '23502', null, 'Null role names are rejected'
);

create temporary table label_fixture (user_id uuid, workspace_id uuid, role_id uuid, copy_id uuid);
grant select, update on label_fixture to authenticated;
insert into label_fixture (user_id) values (gen_random_uuid());
insert into auth.users (id) select user_id from label_fixture;
select set_config('request.jwt.claim.sub', (select user_id::text from label_fixture), true);
set local role authenticated;
update label_fixture set workspace_id = public.create_workspace('Role labels test');
reset role;
with inserted as (
  insert into public.roles (key, name, workspace_id)
  select 'custom.internal', 'Support specialist', workspace_id from label_fixture returning id
)
update label_fixture set role_id = (select id from inserted);
set local role authenticated;
select is(
  public.list_workspace_roles((select workspace_id from label_fixture), 10, null, null, 'SPECIALIST')
    ->'roles'->0->>'name',
  'Support specialist', 'Filtering matches the display name rather than the machine key'
);
select is(
  (public.list_workspace_roles((select workspace_id from label_fixture), 10, null, null, 'internal')->>'total')::integer,
  0, 'Hidden machine keys do not match the display filter'
);
update label_fixture set copy_id = public.duplicate_workspace_role(workspace_id, role_id);
select is(
  (select name from public.roles where id = (select copy_id from label_fixture)),
  'Support specialist (copy)', 'Duplicate preserves the friendly name with a copy suffix'
);
select is(
  (select key from public.roles where id = (select copy_id from label_fixture)),
  'custom.internal (copy)', 'Duplicate machine key remains separate'
);
select is(
  (public.list_workspace_role_members((select workspace_id from label_fixture),
    (select copy_id from label_fixture))->>'total')::integer,
  0, 'Named duplicate has no members'
);
select ok(
  private.has_workspace_permission(
    (select workspace_id from label_fixture),
    (select id from public.permissions where key = 'roles.update')
  ), 'Role display names do not change owner authorization'
);
reset role;
select * from finish();
rollback;
