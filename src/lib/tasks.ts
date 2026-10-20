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

const taskCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  todo: z.number().int().nonnegative(),
  in_progress: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
})
export type TaskCounts = z.infer<typeof taskCountsSchema>

export async function countWorkspaceTasks(workspaceId: string, search = '') {
  const { data, error } = await supabase.rpc('count_workspace_task_summary', {
    target_workspace_id: workspaceId, search_term: search,
  })
  if (error) throw new Error(error.message)
  return taskCountsSchema.parse(data)
}

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Task name is required.'),
})

const updateTaskSchema = createTaskSchema.extend({
  description: z.string(),
  status: z.enum(taskStatuses),
})

export async function updateWorkspaceTask(workspaceId: string, task: Task) {
  const input = updateTaskSchema.parse(task)
  const { data, error } = await supabase.rpc('update_workspace_task', {
    target_workspace_id: workspaceId, target_task_id: task.id,
    task_title: input.title, task_description: input.description, task_status: input.status,
  })
  if (error) throw new Error(error.message)
  return taskSchema.parse(data)
}

export async function deleteWorkspaceTask(workspaceId: string, taskId: string) {
  const { data, error } = await supabase.rpc('delete_workspace_task', {
    target_workspace_id: workspaceId, target_task_id: taskId,
  })
  if (error) throw new Error(error.message)
  return z.object({ id: z.string().uuid() }).parse(data)
}

export async function updateWorkspaceTaskStatus(workspaceId: string, taskId: string, status: TaskStatus) {
  const { data, error } = await supabase.rpc('update_workspace_task', {
    target_workspace_id: workspaceId, target_task_id: taskId, task_status: status,
  })
  if (error) throw new Error(error.message)
  return taskSchema.parse(data)
}

export async function createWorkspaceTask(workspaceId: string, title: string) {
  const input = createTaskSchema.parse({ title })
  const { data, error } = await supabase.rpc('create_workspace_task', {
    target_workspace_id: workspaceId, task_title: input.title,
  })
  if (error) throw new Error(error.message)
  return taskSchema.parse(data)
}

export async function getWorkspaceTasks(workspaceId: string) {
  const pageSchema = z.array(taskSchema.extend({ created_at: z.string() }))
  const tasks: Task[] = []
  let after: z.infer<typeof pageSchema>[number] | undefined
  for (;;) {
    const { data, error } = await supabase.rpc('list_workspace_tasks', {
      target_workspace_id: workspaceId, page_size: 100,
      after_created_at: after?.created_at ?? null, after_id: after?.id ?? null,
    })
    if (error) throw new Error(error.message)
    const page = pageSchema.parse(data)
    tasks.push(...page.map(task => taskSchema.parse(task)))
    if (page.length < 100) return tasks
    after = page[page.length - 1]
  }
}
