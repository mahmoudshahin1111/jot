import { z } from 'zod'
import { supabase } from '@/lib/supabaseClient'

export const taskStatuses = ['todo', 'in_progress', 'done'] as const
export type TaskStatus = (typeof taskStatuses)[number]

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

const taskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: z.enum(taskStatuses),
})

export type Task = z.infer<typeof taskSchema>

export async function getWorkspaceTasks(workspaceId: string) {
  const { data, error } = await supabase.from('tasks')
    .select('id, title, description, status')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return z.array(taskSchema).parse(data)
}
