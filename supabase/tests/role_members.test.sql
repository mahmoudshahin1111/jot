begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table member_fixture (name text primary key, id uuid not null);
grant select on member_fixture to authenticated, anon;
insert into member_fixture select name, gen_random_uuid()
from unnest(array['workspace', 'other_workspace', 'owner', 'member', 'other_member', 'custom', 'foreign_role']) name;
create function pg_temp.f(n text) returns uuid language sql as $$
  select id from member_fixture where name = n;
$$;
insert into auth.users (id, email) values
  (pg_temp.f('owner'), 'role-owner@example.test'),
  (pg_temp.f('member'), 'role-member@example.test'),
  (pg_temp.f('other_member'), 'other-role-member@example.test');
insert into public.workspaces (id, name) values
  (pg_temp.f('workspace'), 'Members test'), (pg_temp.f('other_workspace'), 'Other workspace');
insert into public.roles (id, key, name, workspace_id) values
  (pg_temp.f('custom'), 'Member role', 'Member role', pg_temp.f('workspace')),
  (pg_temp.f('foreign_role'), 'Other member role', 'Other member role', pg_temp.f('other_workspace'));
insert into public.role_permissions (role_id, permission_id)
select pg_temp.f('custom'), id from public.permissions where key = 'tasks.read';
insert into public.workspace_users (workspace_id, user_id, role_id)
select pg_temp.f('workspace'), pg_temp.f('owner'), id from public.roles where is_system and key = 'workspace.owner'
union all
select pg_temp.f('workspace'), pg_temp.f('member'), pg_temp.f('custom')
union all
select pg_temp.f('workspace'), pg_temp.f('other_member'), pg_temp.f('custom')
union all
select pg_temp.f('other_workspace'), pg_temp.f('member'), id from public.roles where is_system and key = 'workspace.viewer';

select set_config('request.jwt.claim.sub', pg_temp.f('owner')::text, true);
set local role authenticated;
select is(
  (public.list_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('custom'))->>'total')::integer,
  2, 'Members are scoped to the selected workspace and role'
);
select is(
  jsonb_array_length(public.list_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('custom'), 1)->'members'),
  2, 'Members return one lookahead row'
);
select is(
  jsonb_array_length(public.list_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('custom'), 1,
    (public.list_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('custom'), 1)->'members'->0->>'user_id')::uuid)->'members'),
  1, 'Member cursor excludes the previous page'
);
select throws_ok(
  $$select public.list_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('foreign_role'))$$,
  '42501', 'Role is not available in this workspace', 'Foreign role members are not disclosed'
);
select throws_ok(
  $$select public.list_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('custom'), 101)$$,
  '22023', 'Invalid pagination parameters', 'Unbounded member requests are rejected'
);
select throws_ok(
  $$select public.remove_workspace_role_member(pg_temp.f('workspace'),
    (select id from public.roles where is_system and key = 'workspace.owner'), pg_temp.f('owner'))$$,
  '23514', 'The last workspace owner cannot be removed', 'Last owner remains assigned'
);
select set_config('request.jwt.claim.sub', pg_temp.f('member')::text, true);
select throws_ok(
  $$select public.remove_workspace_role_member(pg_temp.f('workspace'), pg_temp.f('custom'), pg_temp.f('other_member'))$$,
  '42501', 'You do not have permission to perform this role action', 'Removal requires its own permission'
);
select set_config('request.jwt.claim.sub', pg_temp.f('owner')::text, true);
select lives_ok(
  $$select public.remove_workspace_role_member(pg_temp.f('workspace'), pg_temp.f('custom'), pg_temp.f('member'))$$,
  'Owner can remove a role member'
);
select is(
  (public.list_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('custom'))->>'total')::integer,
  1, 'Member count changes after removal'
);
select set_config('request.jwt.claim.sub', pg_temp.f('member')::text, true);
select ok(not private.is_workspace_member(pg_temp.f('workspace')), 'Removed member loses workspace membership');
select ok(private.is_workspace_member(pg_temp.f('other_workspace')), 'Other workspace membership is preserved');
select ok(not private.has_workspace_permission(pg_temp.f('workspace'),
  (select id from public.permissions where key = 'tasks.read')), 'Removed member loses task access');
select throws_ok(
  $$select public.list_workspace_roles(pg_temp.f('workspace'))$$,
  '42501', 'You no longer have access to this workspace', 'Removed member cannot use role RPCs'
);
set local role anon;
select throws_ok(
  $$select public.list_workspace_role_members(pg_temp.f('workspace'), pg_temp.f('custom'))$$,
  '42501', null, 'Anonymous callers cannot enumerate members'
);
reset role;
select * from finish();
rollback;
