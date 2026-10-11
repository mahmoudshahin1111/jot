import { z } from 'zod'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

export const invitationLimit = 10
export const inviteEmailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254)
const invitationSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), workspace_name: z.string(),
  email: z.string(), role_name: z.string(), created_at: z.string(), expires_at: z.string(),
  delivered_at: z.string().nullable(),
})
const workspaceUserSchema = z.object({
  user_id: z.string().uuid(), role_id: z.string().uuid(), role_name: z.string(),
  name: z.string(), email: z.string(),
})
export type WorkspaceInvitation = z.infer<typeof invitationSchema>
export type WorkspaceUser = z.infer<typeof workspaceUserSchema>

export async function getMyInvitations() {
  const { data, error } = await supabase.rpc('list_my_workspace_invitations')
  if (error) throw error
  return z.array(invitationSchema).parse(data)
}

export async function inviteWorkspaceUser(workspaceId: string, roleId: string, email: string) {
  const { data, error } = await supabase.functions.invoke('invite-workspace-user', {
    body: { workspaceId, roleId, email: inviteEmailSchema.parse(email) },
  })
  if (error instanceof FunctionsHttpError) {
    const body = z.object({ error: z.string() }).parse(await error.context.json())
    throw new Error(body.error)
  }
  if (error) throw error
  return z.object({ id: z.string().uuid() }).parse(data)
}

export async function cancelInvitation(id: string) {
  const { error } = await supabase.rpc('cancel_workspace_invitation', { invitation_id: id })
  if (error) throw error
}

export async function acceptInvitation(id: string) {
  const { data, error } = await supabase.rpc('accept_workspace_invitation', {
    invitation_id: z.string().uuid().parse(id),
  })
  if (error) throw error
  return z.string().uuid().parse(data)
}

export async function getInvitation(id: string) {
  const { data, error } = await supabase.rpc('get_workspace_invitation', {
    invitation_id: z.string().uuid().parse(id),
  })
  if (error) throw error
  return z.object({ workspace_name: z.string(), role_name: z.string(), email: z.string() }).parse(data)
}

export async function getWorkspaceUsers(workspaceId: string, search: string, after?: string) {
  const { data, error } = await supabase.rpc('list_workspace_users', {
    target_workspace_id: workspaceId, search_term: search, after_user_id: after ?? null,
  })
  if (error) throw error
  return z.object({ members: z.array(workspaceUserSchema), total: z.number() }).parse(data)
}
