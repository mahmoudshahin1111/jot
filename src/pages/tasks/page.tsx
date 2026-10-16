import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import { taskStatuses, type TaskStatus } from '@/lib/tasks'
import { AddTaskForm } from './components/add-task-form'
import { TaskTable } from './components/task-table'
import { TaskBoard } from './components/task-board'
import { TaskDetails } from './components/task-details'
import { TaskToolbar, type TaskStatusFilter, type TaskView } from './components/task-toolbar'
import { useWorkspaceTasks } from './hooks/use-workspace-tasks'

export function TasksPage() {
  const { workspaceId } = useParams()
  if (!workspaceId) return <p role="alert">Workspace ID is required.</p>
  return <WorkspaceTasks key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceTasks({ workspaceId }: { workspaceId: string }) {
  const { hasPermission } = useWorkspacePermissions()
  const state = useWorkspaceTasks(workspaceId)
  const [collapsed, setCollapsed] = useState<Partial<Record<TaskStatus, boolean>>>({})
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<TaskView>('list')
  const query = search.trim().toLowerCase()
  const visibleTasks = state.tasks?.filter(task =>
    (statusFilter === 'all' || task.status === statusFilter)
    && (!query || task.title.toLowerCase().includes(query) || task.description.toLowerCase().includes(query)),
  ) ?? []
  const [searchParams] = useSearchParams()
  const linkedTaskId = searchParams.get('task')
  const linkedTask = state.tasks?.find(task => task.id === linkedTaskId) ?? null
  const selectTask = state.select
  useEffect(() => {
    if (linkedTask) void selectTask(linkedTask)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedTask?.id])
  const doneCount = state.tasks?.filter(task => task.status === 'done').length ?? 0

  if (!hasPermission(PERMISSIONS.tasks.read)) {
    return <main className="p-6"><p role="alert">You do not have permission to view tasks.</p></main>
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-6 sm:px-6" aria-label="Tasks">
      <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
      {state.tasks && (
        <p className="mt-2 text-sm text-muted-foreground">
          {state.tasks.length} {state.tasks.length === 1 ? 'task' : 'tasks'} in this workspace, {doneCount} done
        </p>
      )}
      {hasPermission(PERMISSIONS.tasks.create) && (
        <AddTaskForm
          disabled={state.creating || !state.tasks || Boolean(state.error)}
          onCreate={async title => {
            const created = await state.create(title)
            if (created) setCollapsed(current => ({ ...current, todo: false }))
            return created
          }}
        />
      )}
      {state.tasks && (
        <TaskToolbar
          tasks={state.tasks}
          status={statusFilter}
          search={search}
          view={view}
          onViewChange={setView}
          onStatusChange={status => {
            setStatusFilter(status)
            setCollapsed({})
          }}
          onSearchChange={value => { setSearch(value); setCollapsed({}) }}
        />
      )}
      {state.actionError && <p role="alert" className="mt-3 text-sm text-destructive">{state.actionError}</p>}
      {state.notice && <p role="status" className="mt-3 text-sm">{state.notice}</p>}
      <div className="mt-6">
        {state.error ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">{state.error}</p>
            <Button variant="outline" onClick={state.retry}>Try again</Button>
          </div>
        ) : !state.tasks ? (
          <p role="status" className="text-sm text-muted-foreground">Loading tasks...</p>
        ) : (
          <div className={`grid items-start gap-5 ${state.draft ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : ''}`}>
            {view === 'board' ? (
              <TaskBoard
                tasks={visibleTasks}
                statuses={statusFilter === 'all' ? taskStatuses : [statusFilter]}
                searching={Boolean(query)}
                selectedId={state.draft?.id}
                canUpdate={hasPermission(PERMISSIONS.tasks.update)}
                busy={state.mutationId !== null || state.saving || state.moving}
                onSelect={task => { void state.select(task) }}
                onMove={(task, status) => { void state.move(task, status) }}
              />
            ) : <TaskTable
              tasks={visibleTasks}
              statuses={statusFilter === 'all' ? taskStatuses : [statusFilter]}
              searching={Boolean(query)}
              collapsed={collapsed}
              onToggle={status => setCollapsed(current => ({ ...current, [status]: !current[status] }))}
              selectedId={state.draft?.id}
              canUpdate={hasPermission(PERMISSIONS.tasks.update)}
              busy={state.mutationId !== null || state.saving || state.moving}
              onSelect={task => { void state.select(task) }}
              onComplete={task => {
                setCollapsed(current => ({ ...current, todo: false, done: false }))
                void state.complete(task)
              }}
              onMove={(task, status) => {
                setCollapsed(current => ({ ...current, [status]: false }))
                void state.move(task, status)
              }}
            />}
            {state.draft && (
              <TaskDetails
                task={state.draft}
                canUpdate={hasPermission(PERMISSIONS.tasks.update)}
                canDelete={hasPermission(PERMISSIONS.tasks.delete)}
                saving={state.saving}
                dirty={state.dirty}
                saved={state.saved}
                busy={state.mutationId !== null || state.movePending || state.moving}
                error={state.editorError}
                onChange={changes => {
                  const status = changes.status
                  if (status) setCollapsed(current => ({ ...current, [status]: false }))
                  state.changeDraft(changes)
                }}
                onClose={() => { void state.select(null) }}
                onDelete={() => { void state.remove() }}
                onRetry={() => { void state.save() }}
              />
            )}
          </div>
        )}
      </div>
    </main>
  )
}
