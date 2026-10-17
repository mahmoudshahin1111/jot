import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { useRecordCount } from '@/hooks/use-record-count'
import { PERMISSIONS } from '@/lib/permissions'
import {
  activityEventLabel, activityItemPath, activityPageSize, countActivityEvents, getActivityEvents,
  type ActivityCursor, type ActivityEvent,
} from '@/lib/activity'

const eventTypeColors: Record<string, string> = {
  'workspace.created': 'border-slate-500 text-slate-700 dark:text-slate-400',
  'task.created': 'border-cyan-500 text-cyan-700 dark:text-cyan-400',
  'task.updated': 'border-blue-500 text-blue-700 dark:text-blue-400',
  'task.deleted': 'border-indigo-500 text-indigo-700 dark:text-indigo-400',
  'role.created': 'border-violet-500 text-violet-700 dark:text-violet-400',
  'role.updated': 'border-purple-500 text-purple-700 dark:text-purple-400',
  'role.deleted': 'border-fuchsia-500 text-fuchsia-700 dark:text-fuchsia-400',
  'role.permissions.updated': 'border-pink-500 text-pink-700 dark:text-pink-400',
  'member.added': 'border-emerald-500 text-emerald-700 dark:text-emerald-400',
  'member.role_changed': 'border-teal-500 text-teal-700 dark:text-teal-400',
  'member.removed': 'border-lime-500 text-lime-700 dark:text-lime-400',
  'invitation.created': 'border-amber-500 text-amber-700 dark:text-amber-400',
  'invitation.canceled': 'border-orange-500 text-orange-700 dark:text-orange-400',
  'invitation.accepted': 'border-rose-500 text-rose-700 dark:text-rose-400',
}

function EventTypeBadge({ eventType }: { eventType: string }) {
  const color = eventTypeColors[eventType] ?? 'border-transparent bg-muted text-foreground'
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>{activityEventLabel(eventType)}</span>
}

export function ActivityPage() {
  const { workspaceId } = useParams()
  if (!workspaceId) return <p role="alert">Workspace ID is required.</p>
  return <WorkspaceActivity key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceActivity({ workspaceId }: { workspaceId: string }) {
  const { hasPermission } = useWorkspacePermissions()
  const allowed = hasPermission(PERMISSIONS.activity.read)
  const [filter, setFilter] = useState('')
  const [pagination, setPagination] = useState<{ search: string, cursors: (ActivityCursor | null)[], index: number }>({
    search: '', cursors: [null], index: 0,
  })
  const { search, index: pageIndex } = pagination
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [cursor, setCursor] = useState<ActivityCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ActivityEvent | null>(null)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const loadCount = useCallback(() => countActivityEvents(workspaceId, search), [workspaceId, search])
  const count = useRecordCount(loadCount, allowed, attempt)

  useEffect(() => {
    const timeout = setTimeout(() => {
      const nextSearch = filter.trim()
      setPagination(previous => previous.search === nextSearch ? previous : { search: nextSearch, cursors: [null], index: 0 })
    }, 250)
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
      setSelected(null)
      try {
        const page = await getActivityEvents(workspaceId, search, pagination.cursors[pageIndex])
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
  }, [allowed, attempt, search, workspaceId, pagination, pageIndex])

  if (!allowed) {
    return <main className="p-6"><p role="alert">You do not have permission to view workspace activity.</p></main>
  }

  const itemPath = selected ? activityItemPath(workspaceId, selected) : null

  return (
    <main className="mx-auto max-w-7xl px-5 py-6 sm:px-6" aria-label="Activity">
      <h1 className="text-3xl font-semibold tracking-tight">Activity</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Every change made in this workspace, newest first. Select an event to see who did it and what it affected.</p>
      <Input
        className="mt-5 max-w-md"
        type="search"
        placeholder="Search events by description"
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
          {count.error && (
            <div className="mb-4 space-y-2">
              <p role="alert" className="text-sm text-destructive">Unable to load the total: {count.error}</p>
              <Button variant="outline" onClick={count.refresh}>Retry count</Button>
            </div>
          )}
          <div className="overflow-hidden rounded-lg border bg-card">
            {events.length > 0 && (
              <div className="overflow-x-auto">
                <table aria-label="Workspace activity" className="w-full min-w-[44rem] table-fixed text-left text-sm">
                  <colgroup><col className="w-52" /><col /><col className="w-44" /></colgroup>
                  <tbody className="divide-y">
                    {events.map(event => (
                      <tr
                        key={event.id}
                        tabIndex={0}
                        aria-label={`${activityEventLabel(event.event_type)}: ${event.description}, by ${event.actor_name}`}
                        aria-selected={selected?.id === event.id}
                        onClick={() => setSelected(event)}
                        onKeyDown={key => {
                          if (key.key === 'Enter' || key.key === ' ') {
                            key.preventDefault()
                            setSelected(event)
                          }
                        }}
                        className={`cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${selected?.id === event.id ? 'bg-accent' : ''}`}
                      >
                        <td className="px-4 py-3"><EventTypeBadge eventType={event.event_type} /></td>
                        <td className="break-words px-4 py-3">
                          <div className="font-medium">{event.description}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">by {event.actor_name}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                          <time dateTime={event.created_at} title={new Date(event.created_at).toLocaleString()}>
                            {new Date(event.created_at).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && !error && events.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                {search ? 'No activity matches your search.' : 'No activity yet.'}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <p role="status" className="text-xs text-muted-foreground">
                {loading ? 'Loading events...' : error ? 'Activity unavailable.' : `Showing ${events.length ? pageIndex * activityPageSize + 1 : 0} to ${events.length ? pageIndex * activityPageSize + events.length : 0}${count.total === null ? '' : ` of ${count.total}`} events`}
              </p>
              <nav aria-label="Activity pagination" className="flex gap-2">
                <Button variant="outline" disabled={loading || pageIndex === 0} onClick={() => setPagination(previous => ({ ...previous, index: previous.index - 1 }))}>Previous</Button>
                <Button variant="outline" disabled={loading || !!error || !hasMore || !cursor} onClick={() => {
                  if (cursor) setPagination(previous => ({
                    ...previous, cursors: [...previous.cursors.slice(0, previous.index + 1), cursor], index: previous.index + 1,
                  }))
                }}>Next</Button>
              </nav>
            </div>
          </div>
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
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  <EventTypeBadge eventType={selected.event_type} />
                  <span className="font-mono text-xs text-muted-foreground">{selected.event_type}</span>
                </dd>
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
                <dt className="text-xs text-muted-foreground">When</dt>
                <dd><time dateTime={selected.created_at}>{new Date(selected.created_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}</time></dd>
              </div>
              {selected.affected_item_type && selected.affected_item_name && (
                <div>
                  <dt className="text-xs text-muted-foreground">{selected.affected_item_type === 'task' ? 'Task' : 'Role'}</dt>
                  <dd className="break-words">
                    {itemPath
                      ? <Link to={itemPath} className="font-medium text-primary-text underline">{selected.affected_item_name}</Link>
                      : selected.affected_item_name}
                  </dd>
                  <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">id: {selected.affected_item_id}</dd>
                </div>
              )}
            </dl>
          </Card>
        )}
      </div>
    </main>
  )
}
