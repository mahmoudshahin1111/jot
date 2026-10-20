import { taskStatuses, taskStatusLabels, type Task, type TaskCounts, type TaskStatus } from '@/lib/tasks'
import { useTaskDrag } from '../hooks/use-task-drag'
import { StatusPill } from './status-pill'

export function TaskBoard({ tasks, counts, statuses = taskStatuses, searching, selectedId, canUpdate, busy, onSelect, onMove }: {
  tasks: Task[]
  counts: TaskCounts | null
  statuses?: readonly TaskStatus[]
  searching: boolean
  selectedId: string | undefined
  canUpdate: boolean
  busy: boolean
  onSelect: (task: Task) => void
  onMove: (task: Task, status: TaskStatus) => void
}) {
  const { taskDragProps, groupDropProps, dropStatus } = useTaskDrag(tasks, canUpdate && !busy, onMove)

  return (
    <div role="region" aria-label="Task board" className="grid min-w-0 items-start gap-3 md:grid-cols-3">
      {statuses.map(status => {
        const group = tasks.filter(task => task.status === status)
        return (
          <section
            key={status}
            aria-label={taskStatusLabels[status]}
            className={`min-w-0 space-y-3 rounded-lg bg-muted/60 p-3 ${dropStatus === status ? 'outline-2 outline-ring' : ''}`}
            {...groupDropProps(status)}
          >
            <h2 className="flex items-center gap-2">
              <StatusPill status={status} />
              <span className="text-xs text-muted-foreground">{counts?.[status] ?? '...'}</span>
            </h2>
            <ul className="min-h-16 space-y-3">
              {group.map(task => (
                <li key={task.id}>
                  <button
                    type="button"
                    className={`block w-full min-w-0 rounded-lg border bg-card p-3 text-left hover:border-ring focus-visible:outline-2 focus-visible:outline-ring ${selectedId === task.id ? 'border-ring' : 'border-border'}`}
                    aria-label={`Open task: ${task.title}`}
                    aria-pressed={selectedId === task.id}
                    onClick={() => onSelect(task)}
                    {...taskDragProps(task)}
                  >
                    <span className={`block truncate text-xs font-semibold ${task.status === 'done' ? 'text-muted-foreground line-through' : ''}`} title={task.title}>
                      {task.title}
                    </span>
                    {task.description && (
                      <span className="mt-2 line-clamp-3 break-words text-xs leading-5 text-muted-foreground" title={task.description}>{task.description}</span>
                    )}
                  </button>
                </li>
              ))}
              {group.length === 0 && (
                <li className="py-3 text-xs text-muted-foreground">{searching ? 'No matching tasks in this group.' : 'No tasks in this group.'}</li>
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
