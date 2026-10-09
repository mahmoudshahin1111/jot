import { z } from 'zod'
import { supabase } from '@/lib/supabaseClient'

const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
})

export type Workspace = z.infer<typeof workspaceSchema>

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
