import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { taskStatuses, taskStatusLabels, type Task } from '@/lib/tasks'

export function TaskDetails({ task, canUpdate, canDelete, saving, dirty, saved, busy, error, onChange, onClose, onDelete, onRetry }: {
  task: Task
  canUpdate: boolean
  canDelete: boolean
  saving: boolean
  dirty: boolean
  saved: boolean
  busy: boolean
  error: string | null
  onChange: (changes: Partial<Pick<Task, 'title' | 'description' | 'status'>>) => void
  onClose: () => void
  onDelete: () => void
  onRetry: () => void
}) {
  const invalidTitle = !task.title.trim()
  return (
    <Card className="min-w-0 gap-5 p-5" role="region" aria-labelledby="task-details-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="task-details-heading" className="text-lg font-semibold">Task details</h2>
        <Button variant="ghost" size="icon" aria-label="Close task details" disabled={busy} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-2">
        <Label htmlFor="task-title">Title</Label>
        <Input
          id="task-title"
          value={task.title}
          readOnly={!canUpdate || busy}
          aria-invalid={invalidTitle}
          aria-describedby={invalidTitle ? 'task-title-error' : undefined}
          onChange={event => onChange({ title: event.target.value })}
        />
        {invalidTitle && <p id="task-title-error" role="alert" className="text-sm text-destructive">Task name is required.</p>}
      </div>
      <fieldset disabled={!canUpdate || busy} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Status</legend>
        <div className="flex flex-wrap gap-2">
          {taskStatuses.map(status => (
            <Button
              key={status}
              variant={task.status === status ? 'secondary' : 'outline'}
              aria-pressed={task.status === status}
              onClick={() => onChange({ status })}
            >{taskStatusLabels[status]}</Button>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="task-description">Description</Label>
        <textarea
          id="task-description"
          className="min-h-36 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          value={task.description}
          readOnly={!canUpdate || busy}
          onChange={event => onChange({ description: event.target.value })}
        />
      </div>
      {error ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          {canUpdate && dirty && <Button variant="outline" disabled={saving || busy || invalidTitle} onClick={onRetry}>Retry saving</Button>}
        </div>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {saving ? 'Saving...' : dirty ? 'Unsaved changes' : saved ? 'All changes saved.' : canUpdate ? 'Changes save automatically.' : 'You have read-only access to this task.'}
        </p>
      )}
      {canDelete && (
        <div className="flex justify-end">
          <Button variant="destructive" disabled={busy || saving} onClick={onDelete}>Delete task</Button>
        </div>
      )}
    </Card>
  )
}
