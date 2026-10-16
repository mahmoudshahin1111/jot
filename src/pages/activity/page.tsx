import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import {
  activityEventLabel, activityItemPath, getActivityEvents,
  type ActivityCursor, type ActivityEvent,
} from '@/lib/activity'

export function ActivityPage() {
  const { workspaceId } = useParams()
  if (!workspaceId) return <p role="alert">Workspace ID is required.</p>
  return <WorkspaceActivity key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceActivity({ workspaceId }: { workspaceId: string }) {
  const { hasPermission } = useWorkspacePermissions()
  const allowed = hasPermission(PERMISSIONS.activity.read)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [cursor, setCursor] = useState<ActivityCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ActivityEvent | null>(null)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(filter.trim()), 250)
    return () => clearTimeout(timeout)
  }, [filter])

  useEffect(() => {
    if (!allowed) return
    const current = ++generation.current
    async function load() {
      setLoading(true)
      setError(null)
      setEvents([])
      setHasMore(false)
      setCursor(null)
      try {
        const page = await getActivityEvents(workspaceId, search)
        if (generation.current !== current) return
        setEvents(page.events)
        setHasMore(page.has_more)
        setCursor(page.next_cursor)
      } catch (cause) {
        if (generation.current === current) setError(cause instanceof Error ? cause.message : 'Unable to load activity.')
      } finally {
        if (generation.current === current) setLoading(false)
      }
    }
    void load()
    return () => { generation.current = current + 1 }
  }, [allowed, attempt, search, workspaceId])

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !cursor) return
    const current = generation.current
    setLoading(true)
    try {
      const page = await getActivityEvents(workspaceId, search, cursor)
      if (generation.current !== current) return
      setEvents(previous => [...previous, ...page.events])
      setHasMore(page.has_more)
      setCursor(page.next_cursor)
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : 'Unable to load activity.')
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }, [cursor, hasMore, loading, search, workspaceId])

  if (!allowed) {
    return <main className="p-6"><p role="alert">You do not have permission to view workspace activity.</p></main>
  }

  const itemPath = selected ? activityItemPath(workspaceId, selected) : null

  return (
    <main className="mx-auto max-w-7xl px-5 py-6 sm:px-6" aria-label="Activity">
      <h1 className="text-3xl font-semibold tracking-tight">Activity</h1>
      <p className="mt-2 text-sm text-muted-foreground">A history of the changes made in this workspace.</p>
      <Input
        className="mt-5 max-w-md"
        type="search"
        placeholder="Search activity"
        aria-label="Search activity"
        value={filter}
        onChange={event => setFilter(event.target.value)}
      />
      <div className={`mt-6 grid items-start gap-5 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}>
        <div className="min-w-0">
          {error && (
            <div className="mb-4 flex flex-col items-start gap-3">
              <p role="alert" className="text-sm text-destructive">{error}</p>
              <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button>
            </div>
          )}
          {events.length > 0 && (
            <ul aria-label="Workspace activity" className="divide-y rounded-lg border">
              {events.map(event => (
                <li key={event.id}>
                  <button
                    type="button"
                    aria-pressed={selected?.id === event.id}
                    onClick={() => setSelected(event)}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted ${selected?.id === event.id ? 'bg-accent' : ''}`}
                  >
                    <span className="text-xs font-semibold text-primary-text">{activityEventLabel(event.event_type)}</span>
                    <span className="text-sm">{event.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loading && <p role="status" className="py-4 text-sm text-muted-foreground">Loading activity...</p>}
          {!loading && !error && events.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              {search ? 'No activity matches your search.' : 'No activity yet.'}
            </p>
          )}
          {hasMore && !loading && (
            <Button variant="outline" className="mt-4" onClick={() => { void loadMore() }}>Load more activity</Button>
          )}
        </div>
        {selected && (
          <Card className="min-w-0 gap-4 p-5" role="region" aria-labelledby="activity-details-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="activity-details-heading" className="text-lg font-semibold">Event details</h2>
              <Button variant="ghost" size="icon" aria-label="Close event details" onClick={() => setSelected(null)}>
                <X aria-hidden="true" />
              </Button>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Event type</dt>
                <dd>{activityEventLabel(selected.event_type)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Description</dt>
                <dd className="break-words">{selected.description}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Performed by</dt>
                <dd>{selected.actor_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Time</dt>
                <dd>{new Date(selected.created_at).toLocaleString()}</dd>
              </div>
              {selected.affected_item_type && selected.affected_item_name && (
                <div>
                  <dt className="text-xs text-muted-foreground">{selected.affected_item_type === 'task' ? 'Task' : 'Role'}</dt>
                  <dd className="break-words">
                    {itemPath
                      ? <Link to={itemPath} className="font-medium text-primary-text underline">{selected.affected_item_name}</Link>
                      : selected.affected_item_name}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        )}
      </div>
    </main>
  )
}
