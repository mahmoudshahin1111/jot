insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.list_workspace_role_members(
  target_workspace_id uuid, target_role_id uuid, page_size integer default 10, after_user_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  if page_size is null or page_size < 1 or page_size > 100 then
    raise exception 'Invalid pagination parameters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.roles where id = target_role_id
    and (is_system or workspace_id = target_workspace_id)) then
    raise exception 'Role is not available in this workspace' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(to_jsonb(page) order by page.user_id) from (
      select u.user_id, coalesce(a.email, '') as email,
        coalesce(nullif(a.raw_user_meta_data->>'full_name', ''), nullif(a.email, ''), 'Workspace member') as name,
        a.raw_user_meta_data->>'avatar_path' as avatar_path
      from public.workspace_users u join auth.users a on a.id = u.user_id
      where u.workspace_id = target_workspace_id and u.role_id = target_role_id
        and (after_user_id is null or u.user_id > after_user_id)
      order by u.user_id limit page_size + 1
    ) page), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_workspace_users(
  target_workspace_id uuid, search_term text default '', after_user_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role_access(target_workspace_id, 'roles.read');
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(to_jsonb(page) order by page.user_id) from (
      select u.user_id, u.role_id, r.name as role_name, coalesce(a.email, '') as email,
        coalesce(nullif(a.raw_user_meta_data->>'full_name', ''), a.email, 'Workspace member') as name,
        a.raw_user_meta_data->>'avatar_path' as avatar_path
      from public.workspace_users u
      join auth.users a on a.id = u.user_id
      join public.roles r on r.id = u.role_id
      where u.workspace_id = target_workspace_id
        and (after_user_id is null or u.user_id > after_user_id)
        and (coalesce(search_term, '') = '' or strpos(lower(coalesce(a.email, '')), lower(search_term)) > 0
          or strpos(lower(coalesce(a.raw_user_meta_data->>'full_name', '')), lower(search_term)) > 0)
      order by u.user_id limit 11
    ) page), '[]'::jsonb)
  );
end;
$$;
