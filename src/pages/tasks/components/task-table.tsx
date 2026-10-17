import { ChevronDown } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { taskStatuses, taskStatusLabels, type Task, type TaskCounts, type TaskStatus } from '@/lib/tasks'

import { StatusPill } from './status-pill'
import { useTaskDrag } from '../hooks/use-task-drag'

export function TaskTable({ tasks, counts, statuses = taskStatuses, searching = false, collapsed, onToggle, selectedId, canUpdate, busy, onSelect, onComplete, onMove }: {
  tasks: Task[]
  counts: TaskCounts | null
  statuses?: readonly TaskStatus[]
  searching?: boolean
  collapsed: Partial<Record<TaskStatus, boolean>>
  onToggle: (status: TaskStatus) => void
  selectedId: string | undefined
  canUpdate: boolean
  busy: boolean
  onSelect: (task: Task) => void
  onComplete: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
}) {
  const { taskDragProps, groupDropProps, dropStatus } = useTaskDrag(tasks, canUpdate && !busy, onMove)
  return (
    <Card className="min-w-0 overflow-x-auto p-0">
      <table className="w-full min-w-[40rem] table-fixed text-left text-xs" aria-label="Workspace tasks">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th scope="col" className="w-10 px-4 py-3"><span className="sr-only">Done</span></th>
            <th scope="col" className="w-2/5 px-2 py-3 font-medium">Title</th>
            <th scope="col" className="px-2 py-3 font-medium">Description</th>
            <th scope="col" className="w-28 px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        {statuses.map(status => {
          const group = tasks.filter(task => task.status === status)
          const isCollapsed = collapsed[status] === true
          return (
            <tbody
              key={status}
              aria-label={taskStatusLabels[status]}
              className={dropStatus === status ? 'bg-accent/50 outline outline-ring' : undefined}
              {...groupDropProps(status)}
            >
              <tr>
                <td colSpan={4} className="px-4 pt-4 pb-2">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    aria-label={`${taskStatusLabels[status]} (${counts?.[status] ?? '...'})`}
                    onClick={() => onToggle(status)}
                    className="flex items-center gap-2"
                  >
                    <ChevronDown className={`size-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} aria-hidden="true" />
                    <StatusPill status={status} />
                    <span className="text-muted-foreground">{counts?.[status] ?? '...'}</span>
                  </button>
                </td>
              </tr>
              {!isCollapsed && group.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-4 text-muted-foreground">{searching ? 'No matching tasks in this group.' : 'No tasks in this group.'}</td></tr>
              )}
              {!isCollapsed && group.map(task => (
                <tr
                  key={task.id}
                  className={`cursor-pointer hover:bg-accent/50 ${selectedId === task.id ? 'bg-accent' : ''}`}
                  onClick={() => onSelect(task)}
                  {...taskDragProps(task)}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={task.status === 'done'}
                      disabled={!canUpdate || busy}
                      onClick={event => event.stopPropagation()}
                      onChange={() => onComplete(task)}
                      aria-label={`${task.title} completed`}
                      className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className={`px-2 py-3 font-semibold ${task.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>
                    <button
                      type="button"
                      className="block w-full truncate rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
                      title={task.title}
                      aria-pressed={selectedId === task.id}
                    >{task.title}</button>
                  </td>
                  <td className="truncate px-2 py-3 text-muted-foreground" title={task.description}>{task.description}</td>
                  <td className="px-4 py-3"><StatusPill status={task.status} /></td>
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
    </Card>
  )
}
