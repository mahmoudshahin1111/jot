import { z } from 'zod'
import { supabase } from '@/lib/supabaseClient'

export function roleErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Unable to complete the role action. Please try again.'
}

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
const candidateSchema = memberSchema.extend({
  role_id: z.string().uuid(),
  role_name: z.string(),
})
export type RoleMemberCandidate = z.infer<typeof candidateSchema>

export async function getRoleMemberCandidates(workspaceId: string, roleId: string, search: string, after?: string) {
  const { data, error } = await supabase.rpc('list_workspace_role_candidates', {
    target_workspace_id: workspaceId, target_role_id: roleId,
    search_term: search, after_user_id: after ?? null, page_size: rolePageSize,
  })
  if (error) throw error
  return z.array(candidateSchema).parse(data)
}

export async function addRoleMember(workspaceId: string, roleId: string, member: RoleMemberCandidate) {
  const { error } = await supabase.rpc('assign_workspace_role_member', {
    target_workspace_id: workspaceId, target_role_id: roleId,
    target_user_id: member.user_id, expected_role_id: member.role_id,
  })
  if (error) throw error
}
export type RolesPage = z.infer<typeof rolesPageSchema>

export const rolePageSize = 10

export const createRoleSchema = z.object({
  name: z.string().trim().min(1, 'Role name is required.'),
})

export async function createRole(workspaceId: string, name: string) {
  const input = createRoleSchema.parse({ name })
  const { data, error } = await supabase.rpc('create_workspace_role', {
    target_workspace_id: workspaceId,
    role_name: input.name,
  })
  if (error) throw error
  return roleSchema.parse(data)
}

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

export async function getRole(workspaceId: string, roleId: string) {
  const { data, error } = await supabase.rpc('get_workspace_role', {
    target_workspace_id: workspaceId, target_role_id: roleId,
  })
  if (error) throw error
  return data ? roleSchema.parse(data) : null
}

export async function duplicateRole(workspaceId: string, roleId: string) {
  const { data, error } = await supabase.rpc('duplicate_workspace_role_details', {
    target_workspace_id: workspaceId, target_role_id: roleId,
  })
  if (error) throw error
  return roleSchema.parse(data)
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
