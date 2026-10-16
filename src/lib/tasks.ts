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

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Task name is required.'),
})

const updateTaskSchema = createTaskSchema.extend({
  description: z.string(),
  status: z.enum(taskStatuses),
})

export async function updateWorkspaceTask(workspaceId: string, task: Task) {
  const input = updateTaskSchema.parse(task)
  const { data, error } = await supabase.from('tasks')
    .update(input).eq('workspace_id', workspaceId).eq('id', task.id)
    .select('id, title, description, status').single()
  if (error) throw new Error(error.message)
  return taskSchema.parse(data)
}

export async function deleteWorkspaceTask(workspaceId: string, taskId: string) {
  const { data, error } = await supabase.from('tasks')
    .delete().eq('workspace_id', workspaceId).eq('id', taskId).select('id').single()
  if (error) throw new Error(error.message)
  return z.object({ id: z.string().uuid() }).parse(data)
}

export async function updateWorkspaceTaskStatus(workspaceId: string, taskId: string, status: TaskStatus) {
  const { data, error } = await supabase.from('tasks')
    .update({ status }).eq('workspace_id', workspaceId).eq('id', taskId)
    .select('id, title, description, status').single()
  if (error) throw new Error(error.message)
  return taskSchema.parse(data)
}

export async function createWorkspaceTask(workspaceId: string, title: string) {
  const input = createTaskSchema.parse({ title })
  const { data, error } = await supabase.from('tasks')
    .insert({ workspace_id: workspaceId, title: input.title })
    .select('id, title, description, status')
    .single()
  if (error) throw new Error(error.message)
  return taskSchema.parse(data)
}

export async function getWorkspaceTasks(workspaceId: string) {
  const { data, error } = await supabase.from('tasks')
    .select('id, title, description, status')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return z.array(taskSchema).parse(data)
}
