import { z } from 'zod'
import { supabase } from '@/lib/supabaseClient'

export const activityPageSize = 20

const activityEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  description: z.string(),
  actor_user_id: z.string().uuid().nullable(),
  actor_name: z.string(),
  created_at: z.string(),
  affected_item_type: z.enum(['role', 'task']).nullable(),
  affected_item_id: z.string().uuid().nullable(),
  affected_item_name: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
})

const activityCursorSchema = z.object({ created_at: z.string(), id: z.string().uuid() })

const activityPageSchema = z.object({
  events: z.array(activityEventSchema),
  has_more: z.boolean(),
  next_cursor: activityCursorSchema.nullable(),
  total_count: z.number().int().nonnegative(),
})

export type ActivityEvent = z.infer<typeof activityEventSchema>
export type ActivityCursor = z.infer<typeof activityCursorSchema>

export const activityEventLabels: Record<string, string> = {
  'workspace.created': 'Workspace created',
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'task.deleted': 'Task deleted',
  'role.created': 'Role created',
  'role.updated': 'Role updated',
  'role.deleted': 'Role deleted',
  'role.permissions.updated': 'Role permissions updated',
  'member.added': 'Member added',
  'member.role_changed': 'Member role changed',
  'member.removed': 'Member removed',
  'invitation.created': 'Invitation sent',
  'invitation.canceled': 'Invitation canceled',
  'invitation.accepted': 'Invitation accepted',
}

export function activityEventLabel(eventType: string) {
  return activityEventLabels[eventType] ?? eventType
}

export function activityItemPath(workspaceId: string, event: ActivityEvent) {
  if (!event.affected_item_id) return null
  const base = `/workspaces/${workspaceId}`
  if (event.affected_item_type === 'task' && event.event_type !== 'task.deleted') {
    return `${base}/tasks?task=${event.affected_item_id}`
  }
  if (event.affected_item_type === 'role' && event.event_type !== 'role.deleted') {
    return `${base}/settings/roles?role=${event.affected_item_id}`
  }
  return null
}

export async function getActivityEvents(workspaceId: string, search: string, after?: ActivityCursor | null) {
  const { data, error } = await supabase.rpc('list_workspace_activity_events', {
    target_workspace_id: workspaceId,
    page_size: activityPageSize,
    before_created_at: after?.created_at ?? null,
    before_id: after?.id ?? null,
    search_term: search,
  })
  if (error) throw new Error(error.message)
  return activityPageSchema.parse(data)
}
