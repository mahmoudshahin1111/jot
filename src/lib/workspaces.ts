import { z } from 'zod'
import { supabase } from '@/lib/supabaseClient'

const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
})

export type Workspace = z.infer<typeof workspaceSchema>

const workspaceAccessSchema = workspaceSchema.extend({
  role_id: z.string().uuid(),
  is_owner: z.boolean(),
  permissions: z.array(z.string()).min(1),
})

export async function getWorkspaceAccess(id: string) {
  const { data, error } = await supabase.rpc('get_workspace_access', { target_workspace_id: id })
  if (error) throw new Error(error.message)
  return data === null ? null : workspaceAccessSchema.parse(data)
}

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Enter a workspace name.'),
})

export async function getUserWorkspaces() {
  const { data, error } = await supabase.from('workspaces')
    .select('id, name').order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return z.array(workspaceSchema).parse(data)
}

export async function createWorkspace(name: string) {
  const { data, error } = await supabase.rpc('create_workspace', { workspace_name: name })
  if (error) throw new Error(error.message)
  return z.string().uuid().parse(data)
}

export async function getWorkspace(id: string) {
  const { data, error } = await supabase.from('workspaces')
    .select('id, name').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data === null ? null : workspaceSchema.parse(data)
}
