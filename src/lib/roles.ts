import { z } from 'zod'
import { supabase } from '@/lib/supabaseClient'

export const roleSchema = z.object({
  id: z.string().uuid(),
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  is_system: z.boolean(),
  member_count: z.number(),
  permission_ids: z.array(z.string().uuid()),
})

const permissionSchema = z.object({
  id: z.string().uuid(),
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string(),
})

const memberSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
})

const rolesPageSchema = z.object({
  roles: z.array(roleSchema),
  total: z.number(),
  permissions: z.array(permissionSchema),
  capabilities: z.object({
    update: z.boolean(),
    create: z.boolean(),
    delete: z.boolean(),
    remove_members: z.boolean(),
  }),
})

export type WorkspaceRole = z.infer<typeof roleSchema>
export type Permission = z.infer<typeof permissionSchema>
export type RoleMember = z.infer<typeof memberSchema>
export type RolesPage = z.infer<typeof rolesPageSchema>

export const rolePageSize = 10

export async function getRoles(workspaceId: string, search: string, after?: WorkspaceRole) {
  const { data, error } = await supabase.rpc('list_workspace_roles', {
    target_workspace_id: workspaceId,
    page_size: rolePageSize,
    search_term: search,
    after_key: after?.key ?? null,
    after_id: after?.id ?? null,
  })
  if (error) throw error
  return rolesPageSchema.parse(data)
}

export async function getRoleMembers(workspaceId: string, roleId: string, after?: string) {
  const { data, error } = await supabase.rpc('list_workspace_role_members', {
    target_workspace_id: workspaceId,
    target_role_id: roleId,
    page_size: rolePageSize,
    after_user_id: after ?? null,
  })
  if (error) throw error
  return z.object({ members: z.array(memberSchema), total: z.number() }).parse(data)
}

export async function saveRolePermissions(workspaceId: string, role: WorkspaceRole, permissionIds: string[]) {
  const { error } = await supabase.rpc('save_workspace_role_permissions', {
    target_workspace_id: workspaceId,
    target_role_id: role.id,
    permission_ids: permissionIds,
    expected_permission_ids: role.permission_ids,
  })
  if (error) throw error
}

export async function duplicateRole(workspaceId: string, roleId: string) {
  const { data, error } = await supabase.rpc('duplicate_workspace_role', {
    target_workspace_id: workspaceId, target_role_id: roleId,
  })
  if (error) throw error
  const id = z.string().uuid().parse(data)
  const [roleResult, permissionsResult] = await Promise.all([
    supabase.from('roles').select('id, key, name, is_system').eq('id', id).single(),
    supabase.from('role_permissions').select('permission_id').eq('role_id', id),
  ])
  if (roleResult.error) throw roleResult.error
  if (permissionsResult.error) throw permissionsResult.error
  const permissions = z.array(z.object({ permission_id: z.string().uuid() })).parse(permissionsResult.data)
  return roleSchema.parse({
    ...roleResult.data,
    member_count: 0,
    permission_ids: permissions.map(permission => permission.permission_id),
  })
}

export async function deleteRole(workspaceId: string, roleId: string) {
  const { error } = await supabase.rpc('delete_workspace_role', {
    target_workspace_id: workspaceId, target_role_id: roleId,
  })
  if (error) throw error
}

export async function removeRoleMember(workspaceId: string, roleId: string, userId: string) {
  const { error } = await supabase.rpc('remove_workspace_role_member', {
    target_workspace_id: workspaceId, target_role_id: roleId, target_user_id: userId,
  })
  if (error) throw error
}
