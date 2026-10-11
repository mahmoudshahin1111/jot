\set ON_ERROR_STOP on
begin;

create temporary table role_test_fixture (
  workspace_id uuid, other_workspace_id uuid, owner_id uuid, member_id uuid,
  viewer_id uuid, outsider_id uuid, owner_role_id uuid, editor_role_id uuid
);
grant select on role_test_fixture to authenticated;

do $$
declare
  workspace_id uuid := gen_random_uuid();
  other_workspace_id uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  owner_role_id uuid;
  editor_role_id uuid;
  viewer_role_id uuid;
begin
  select id into owner_role_id from public.roles where is_system and key = 'workspace.owner';
  select id into editor_role_id from public.roles where is_system and key = 'workspace.editor';
  select id into viewer_role_id from public.roles where is_system and key = 'workspace.viewer';
  insert into auth.users (id, email) values
    (owner_id, owner_id::text || '@example.invalid'),
    (member_id, member_id::text || '@example.invalid'),
    (viewer_id, viewer_id::text || '@example.invalid'),
    (outsider_id, outsider_id::text || '@example.invalid');
  insert into public.workspaces (id, name) values
    (workspace_id, 'Role regression test'), (other_workspace_id, 'Other workspace');
  insert into public.workspace_users (workspace_id, user_id, role_id) values
    (workspace_id, owner_id, owner_role_id),
    (workspace_id, member_id, editor_role_id),
    (workspace_id, viewer_id, viewer_role_id),
    (other_workspace_id, outsider_id, owner_role_id);
  insert into role_test_fixture values
    (workspace_id, other_workspace_id, owner_id, member_id, viewer_id, outsider_id, owner_role_id, editor_role_id);
end;
$$;

set local role authenticated;

do $$
declare
  f record;
  created jsonb;
  created_id uuid;
  other_role_id uuid;
  permission_id uuid;
  assignment_permission_id uuid;
  candidates jsonb;
  page jsonb;
begin
  select * into f from role_test_fixture;
  perform set_config('request.jwt.claim.sub', f.owner_id::text, true);
  created := public.create_workspace_role(f.workspace_id, '  Regression role  ');
  created_id := (created->>'id')::uuid;
  assert created->>'name' = 'Regression role', 'Role names must be trimmed';
  assert created->>'is_system' = 'false', 'Created roles must be custom';
  assert created->'permission_ids' = '[]'::jsonb, 'Created roles must have no permissions';
  assert created->>'member_count' = '0', 'Created roles must have no members';
  assert exists (select 1 from public.roles where id = created_id and workspace_id = f.workspace_id),
    'Role creation must persist in the requested workspace';
  assert public.create_workspace_role(f.workspace_id, 'Regression role')->>'key' <> created->>'key',
    'Display names may repeat but generated keys must be unique';
  begin
    perform public.create_workspace_role(f.workspace_id, '   ');
    raise exception 'Blank role names were accepted';
  exception when sqlstate '22023' then null;
  end;

  select id into permission_id from public.permissions where key = 'tasks.read';
  perform public.save_workspace_role_permissions(f.workspace_id, created_id, array[permission_id], '{}'::uuid[]);
  page := public.list_workspace_roles(f.workspace_id, search_term => 'Regression role');
  assert exists (select 1 from jsonb_array_elements(page->'roles') r
    where r->>'id' = created_id::text and r->'permission_ids' @> to_jsonb(array[permission_id])),
    'Saved role permissions must be readable';

  candidates := public.list_workspace_role_candidates(f.workspace_id, created_id);
  assert jsonb_array_length(candidates) = 2, 'Candidates must exclude outsiders and the last owner';
  assert jsonb_array_length(public.list_workspace_role_candidates(
    f.workspace_id, created_id, search_term => f.member_id::text)) = 1, 'Candidate email search must work';
  assert jsonb_array_length(public.list_workspace_role_candidates(
    f.workspace_id, created_id, page_size => 1, after_user_id => 'ffffffff-ffff-ffff-ffff-ffffffffffff')) = 0,
    'Candidate cursor pagination must work';

  perform public.assign_workspace_role_member(f.workspace_id, created_id, f.member_id, f.editor_role_id);
  page := public.list_workspace_role_members(f.workspace_id, created_id);
  assert page->>'total' = '1' and page->'members'->0->>'user_id' = f.member_id::text,
    'Assigned members and counts must persist';
  assert jsonb_array_length(public.list_workspace_role_candidates(f.workspace_id, created_id)) = 1,
    'Already assigned members must not be candidates';
  begin
    perform public.assign_workspace_role_member(f.workspace_id, created_id, f.viewer_id, f.editor_role_id);
    raise exception 'Stale expected roles were accepted';
  exception when sqlstate '40001' then null;
  end;
  begin
    perform public.assign_workspace_role_member(f.workspace_id, created_id, f.outsider_id, f.owner_role_id);
    raise exception 'An outsider was assigned';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.assign_workspace_role_member(f.workspace_id, created_id, f.owner_id, f.owner_role_id);
    raise exception 'The last owner was reassigned';
  exception when sqlstate '23514' then null;
  end;
  begin
    perform public.delete_workspace_role(f.workspace_id, created_id);
    raise exception 'A populated role was deleted';
  exception when sqlstate '23514' then null;
  end;

  select id into assignment_permission_id from public.permissions where key = 'roles.members.add';
  perform public.save_workspace_role_permissions(f.workspace_id, created_id,
    array[permission_id, assignment_permission_id], array[permission_id]);
  perform set_config('request.jwt.claim.sub', f.member_id::text, true);
  assert jsonb_array_length(public.list_workspace_role_candidates(f.workspace_id, f.editor_role_id)) = 1,
    'Non-owner candidates must exclude themselves and owners';
  begin
    perform public.assign_workspace_role_member(f.workspace_id, f.editor_role_id, f.member_id, created_id);
    raise exception 'A non-owner changed their own role';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.assign_workspace_role_member(f.workspace_id, f.owner_role_id, f.viewer_id, f.editor_role_id);
    raise exception 'A non-owner assigned the Owner role';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub', f.owner_id::text, true);

  perform set_config('request.jwt.claim.sub', f.outsider_id::text, true);
  other_role_id := (public.create_workspace_role(f.other_workspace_id, 'Other role')->>'id')::uuid;
  perform set_config('request.jwt.claim.sub', f.owner_id::text, true);
  begin
    perform public.assign_workspace_role_member(f.workspace_id, other_role_id, f.viewer_id, f.editor_role_id);
    raise exception 'A cross-workspace role was assigned';
  exception when sqlstate '42501' then null;
  end;

  perform public.remove_workspace_role_member(f.workspace_id, created_id, f.member_id);
  assert public.list_workspace_role_members(f.workspace_id, created_id)->>'total' = '0',
    'Removing a member must revoke their membership';
  perform public.delete_workspace_role(f.workspace_id, created_id);
  assert not exists (select 1 from public.roles where id = created_id), 'Empty role deletion must persist';

  perform set_config('request.jwt.claim.sub', f.viewer_id::text, true);
  begin
    perform public.create_workspace_role(f.workspace_id, 'Unauthorized');
    raise exception 'A viewer created a role';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.list_workspace_role_candidates(f.workspace_id, f.editor_role_id);
    raise exception 'A viewer read assignment candidates';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.assign_workspace_role_member(f.workspace_id, f.editor_role_id, f.owner_id, f.owner_role_id);
    raise exception 'A viewer assigned a role';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.create_workspace_role(f.workspace_id, 'Unauthenticated');
    raise exception 'An unauthenticated caller created a role';
  exception when sqlstate '42501' then null;
  end;
  assert not has_function_privilege('anon', 'public.create_workspace_role(uuid,text)', 'execute');
  assert not has_function_privilege('anon', 'public.assign_workspace_role_member(uuid,uuid,uuid,uuid)', 'execute');
  raise notice 'Role creation, permission persistence, assignment, removal, scope and authorization assertions passed';
end;
$$;

rollback;
