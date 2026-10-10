alter table public.permissions add column label text;

update public.permissions
set label = case name
  when 'tasks.read' then 'View tasks'
  when 'tasks.update' then 'Update tasks'
  when 'tasks.delete' then 'Delete tasks'
  when 'roles.read' then 'View roles and members'
  when 'roles.create' then 'Duplicate roles'
  when 'roles.update' then 'Update role permissions'
  when 'roles.delete' then 'Delete roles'
  when 'roles.members.remove' then 'Remove workspace members'
  else initcap(replace(replace(name, '.', ' '), '_', ' '))
end;

alter table public.permissions alter column label set not null;
alter table public.permissions
  add constraint permissions_label_not_blank check (length(trim(label)) > 0);
