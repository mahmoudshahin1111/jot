import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getWorkspaceTasks, taskStatuses, taskStatusLabels, type Task, type TaskStatus } from '@/lib/tasks'

const pillStyles: Record<TaskStatus, string> = {
  todo: 'border-input',
  in_progress: 'border-blue-500 text-blue-500',
  done: 'border-green-500 text-green-500',
}

function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-block shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pillStyles[status]}`}>
      {taskStatusLabels[status]}
    </span>
  )
}

export function TasksPage() {
  const { workspaceId } = useParams()
  if (!workspaceId) return <p role="alert">Workspace ID is required.</p>
  return <WorkspaceTasks key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceTasks({ workspaceId }: { workspaceId: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [collapsed, setCollapsed] = useState<Partial<Record<TaskStatus, boolean>>>({})

  useEffect(() => {
    let active = true
    getWorkspaceTasks(workspaceId)
      .then(data => { if (active) { setTasks(data); setError(null) } })
      .catch(() => { if (active) setError('Could not load tasks. Please try again.') })
    return () => { active = false }
  }, [workspaceId, attempt])

  const retry = () => { setTasks(null); setError(null); setAttempt(value => value + 1) }
  const doneCount = tasks?.filter(task => task.status === 'done').length ?? 0

  return (
    <main className="mx-auto max-w-7xl px-5 py-6 sm:px-6" aria-label="Tasks">
      <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
      {tasks && (
        <p className="mt-2 text-sm text-muted-foreground">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} in this workspace, {doneCount} done
        </p>
      )}
      <div className="mt-6">
        {error ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={retry}>Try again</Button>
          </div>
        ) : !tasks ? (
          <p role="status" className="text-sm text-muted-foreground">Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <Card className="items-center px-6 py-12 text-center">
            <p className="font-medium">No tasks yet</p>
            <p className="text-sm text-muted-foreground">Tasks created in this workspace will appear here.</p>
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="w-10 px-4 py-3"><span className="sr-only">Done</span></th>
                  <th scope="col" className="px-2 py-3 font-medium">Title</th>
                  <th scope="col" className="px-2 py-3 font-medium">Description</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              {taskStatuses.map(status => {
                const group = tasks.filter(task => task.status === status)
                if (group.length === 0) return null
                const isCollapsed = collapsed[status] === true
                return (
                  <tbody key={status}>
                    <tr>
                      <td colSpan={4} className="px-4 pt-4 pb-2">
                        <button
                          type="button"
                          aria-expanded={!isCollapsed}
                          onClick={() => setCollapsed(current => ({ ...current, [status]: !isCollapsed }))}
                          className="flex items-center gap-2"
                        >
                          <ChevronDown className={`size-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} aria-hidden="true" />
                          <StatusPill status={status} />
                          <span className="text-muted-foreground">{group.length}</span>
                        </button>
                      </td>
                    </tr>
                    {!isCollapsed && group.map(task => (
                      <tr key={task.id}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={task.status === 'done'} readOnly disabled aria-label={`${task.title} completed`} className="size-4 accent-primary" />
                        </td>
                        <td className={`px-2 py-3 font-semibold ${task.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>{task.title}</td>
                        <td className="max-w-xs truncate px-2 py-3 text-muted-foreground" title={task.description}>{task.description}</td>
                        <td className="px-4 py-3"><StatusPill status={task.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </Card>
        )}
      </div>
    </main>
  )
}
