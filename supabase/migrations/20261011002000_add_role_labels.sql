alter table public.roles add column label text;

update public.roles
set label = case
  when is_system and name = 'workspace.owner' then 'Owner'
  when is_system and name = 'workspace.editor' then 'Editor'
  when is_system and name = 'workspace.viewer' then 'Viewer'
  else name
end;

alter table public.roles alter column label set not null;
alter table public.roles
  add constraint roles_label_not_blank check (length(trim(label)) > 0);

create or replace function public.list_workspace_roles(
  target_workspace_id uuid, page_size integer default 10,
  after_name text default null, after_id uuid default null, search_term text default ''
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  if page_size is null or page_size < 1 or page_size > 100
    or (after_name is null) <> (after_id is null) then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.name, page.id) from (
        select r.id, r.name, r.label, r.is_system,
          (select count(*) from public.workspace_users u
            where u.workspace_id = target_workspace_id and u.role_id = r.id) as member_count,
          coalesce((select jsonb_agg(rp.permission_id order by rp.permission_id)
            from public.role_permissions rp where rp.role_id = r.id), '[]'::jsonb) as permission_ids
        from public.roles r
        where (r.is_system or r.workspace_id = target_workspace_id)
          and (coalesce(search_term, '') = '' or strpos(lower(r.label), lower(search_term)) > 0)
          and (after_id is null or (r.name, r.id) > (after_name, after_id))
        order by r.name, r.id limit page_size + 1
      ) page
    ), '[]'::jsonb),
    'total', (select count(*) from public.roles r
      where (r.is_system or r.workspace_id = target_workspace_id)
        and (coalesce(search_term, '') = '' or strpos(lower(r.label), lower(search_term)) > 0)),
    'permissions', (select jsonb_agg(to_jsonb(p) order by p.name) from public.permissions p),
    'capabilities', jsonb_build_object(
      'update', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where name = 'roles.update')),
      'create', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where name = 'roles.create')),
      'delete', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where name = 'roles.delete')),
      'remove_members', private.has_workspace_permission(target_workspace_id, (select id from public.permissions where name = 'roles.members.remove'))
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.duplicate_workspace_role(target_workspace_id uuid, target_role_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare source_name text; source_label text; new_id uuid; candidate text; copy_suffix text; suffix integer := 1;
begin
  perform private.require_role_access(target_workspace_id, 'roles.create');
  select name, label into source_name, source_label from public.roles where id = target_role_id
    and (is_system or workspace_id = target_workspace_id) for share;
  if not found then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;
  loop
    copy_suffix := ' (copy' || case when suffix = 1 then '' else ' ' || suffix::text end || ')';
    candidate := source_name || copy_suffix;
    insert into public.roles (name, label, is_system, workspace_id)
      values (candidate, source_label || copy_suffix, false, target_workspace_id)
      on conflict do nothing returning id into new_id;
    exit when new_id is not null;
    suffix := suffix + 1;
  end loop;
  insert into public.role_permissions (role_id, permission_id)
    select new_id, permission_id from public.role_permissions where role_id = target_role_id;
  return new_id;
end;
$$;
