import { Columns3, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { taskStatuses, taskStatusLabels, type TaskCounts, type TaskStatus } from '@/lib/tasks'

export type TaskStatusFilter = 'all' | TaskStatus
export type TaskView = 'list' | 'board'

export function TaskToolbar({ counts, status, search, view, onViewChange, onStatusChange, onSearchChange }: {
  counts: TaskCounts | null
  status: TaskStatusFilter
  search: string
  view: TaskView
  onViewChange: (view: TaskView) => void
  onStatusChange: (status: TaskStatusFilter) => void
  onSearchChange: (search: string) => void
}) {
  return (
    <div className="mt-6 flex min-w-0 flex-wrap items-center gap-3">
      <div role="group" aria-label="Task view" className="flex shrink-0 gap-1 rounded-lg bg-muted p-1">
        <Button variant="ghost" aria-pressed={view === 'list'} className={view === 'list' ? 'bg-background shadow-sm' : ''} onClick={() => onViewChange('list')}>
          <List aria-hidden="true" /> List
        </Button>
        <Button variant="ghost" aria-pressed={view === 'board'} className={view === 'board' ? 'bg-background shadow-sm' : ''} onClick={() => onViewChange('board')}>
          <Columns3 aria-hidden="true" /> Board
        </Button>
      </div>
      <div role="group" aria-label="Filter tasks by status" className="flex flex-wrap gap-2">
        {(['all', ...taskStatuses] as const).map(value => (
          <Button
            key={value}
            variant={status === value ? 'secondary' : 'outline'}
            className="rounded-full text-xs"
            aria-pressed={status === value}
            onClick={() => onStatusChange(value)}
          >
            {value === 'all' ? 'All' : taskStatusLabels[value]}
            <span className="text-muted-foreground">
              {counts?.[value] ?? '...'}
            </span>
          </Button>
        ))}
      </div>
      <Input
        type="search"
        className="min-w-0 basis-48 sm:ml-auto sm:max-w-64"
        aria-label="Search tasks"
        placeholder="Search tasks"
        value={search}
        onChange={event => onSearchChange(event.target.value)}
      />
    </div>
  )
}
