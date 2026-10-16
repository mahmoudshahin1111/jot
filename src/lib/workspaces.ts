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
  const pageSchema = z.array(workspaceSchema.extend({ created_at: z.string() }))
  const workspaces: Workspace[] = []
  let after: z.infer<typeof pageSchema>[number] | undefined
  for (;;) {
    const { data, error } = await supabase.rpc('list_my_workspaces', {
      page_size: 100, after_created_at: after?.created_at ?? null, after_id: after?.id ?? null,
    })
    if (error) throw new Error(error.message)
    const page = pageSchema.parse(data)
    workspaces.push(...page.map(workspace => workspaceSchema.parse(workspace)))
    if (page.length < 100) return workspaces
    after = page[page.length - 1]
  }
}

export async function createWorkspace(name: string) {
  const { data, error } = await supabase.rpc('create_workspace', { workspace_name: name })
  if (error) throw new Error(error.message)
  return z.string().uuid().parse(data)
}

export async function getWorkspace(id: string) {
  const access = await getWorkspaceAccess(id)
  return access === null ? null : workspaceSchema.parse(access)
}
