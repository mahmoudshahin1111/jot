import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Mail, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { InviteUserDialog } from '@/components/invite-user-dialog'
import { WorkspaceNavigationContext } from '@/hooks/use-workspace-shell'
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll'
import { roleErrorMessage } from '@/hooks/use-workspace-roles'
import { cancelInvitation, getMyInvitations, getWorkspaceUsers, invitationLimit, type WorkspaceInvitation, type WorkspaceUser } from '@/lib/invitations'
import { PERMISSIONS } from '@/lib/permissions'
import { removeRoleMember, rolePageSize } from '@/lib/roles'
import { supabase } from '@/lib/supabaseClient'

export function UsersPage() {
  const { workspaceId } = useParams()
  if (!workspaceId) return <p role="alert">Workspace ID is required.</p>
  return <WorkspaceUsers key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceUsers({ workspaceId }: { workspaceId: string }) {
  const access = useContext(WorkspaceNavigationContext)
  const [section, setSection] = useState<'users' | 'invitations'>('users')
  const [members, setMembers] = useState<WorkspaceUser[]>([])
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [revision, setRevision] = useState(0)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const canRead = access?.permissions.includes(PERMISSIONS.roles.read) ?? false
  const canInvite = access?.permissions.includes(PERMISSIONS.roles.addMembers) ?? false
  const canRemove = access?.permissions.includes(PERMISSIONS.roles.removeMembers) ?? false

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(filter.trim()), 250)
    return () => clearTimeout(timeout)
  }, [filter])

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    if (!canRead) return
    let active = true
    let channel: ReturnType<typeof supabase.channel> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const scheduleRefresh = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => { if (active) setRevision(value => value + 1) }, 50)
    }
    async function subscribe() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in again to receive invitation updates.')
        await supabase.realtime.setAuth(data.session.access_token)
        if (!active) return
        channel = supabase.channel(`workspace-invitations:${data.session.user.id}`, { config: { private: true } })
          .on('broadcast', { event: 'invitations_changed' }, scheduleRefresh)
          .subscribe(status => {
            if (!active) return
            if (status === 'SUBSCRIBED') {
              setConnectionError(null)
              scheduleRefresh()
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              setConnectionError('Live invitation updates are unavailable. Refresh the list or retry the connection.')
            }
          })
      } catch (cause) {
        if (active) setConnectionError(roleErrorMessage(cause))
      }
    }
    void subscribe()
    return () => {
      active = false
      clearTimeout(timeout)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [canRead, connectionAttempt])

  useEffect(() => {
    const current = ++generation.current
    if (!canRead) return
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [page, pending] = await Promise.all([getWorkspaceUsers(workspaceId, search), getMyInvitations()])
        if (current !== generation.current) return
        setMembers(page.members.slice(0, rolePageSize))
        setTotal(page.total)
        setHasMore(page.members.length > rolePageSize)
        setInvitations(pending)
      } catch (cause) {
        if (current === generation.current) setError(roleErrorMessage(cause))
      } finally {
        if (current === generation.current) setLoading(false)
      }
    }
    void load()
    return () => { generation.current = current + 1 }
  }, [workspaceId, search, revision, canRead])

  const loadMore = useCallback(async () => {
    if (loading || busy || error || !hasMore) return
    const current = generation.current
    setLoading(true)
    try {
      const page = await getWorkspaceUsers(workspaceId, search, members[members.length - 1]?.user_id)
      if (current !== generation.current) return
      setMembers(previous => [...previous, ...page.members.slice(0, rolePageSize)])
      setHasMore(page.members.length > rolePageSize)
    } catch (cause) {
      if (current === generation.current) setError(roleErrorMessage(cause))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [workspaceId, search, members, loading, busy, error, hasMore])
  const { containerRef, sentinelRef } = useInfiniteScroll(() => { void loadMore() }, section === 'users' && hasMore && !loading && !busy && !error)

  async function remove(id: string, member?: WorkspaceUser) {
    if (inFlight.current || !window.confirm(member
      ? `Remove ${member.name} from this workspace? They will lose workspace access.`
      : 'Remove this invitation? Its email link will no longer grant workspace access.')) return
    inFlight.current = true
    setBusy(true)
    setActionError(null)
    setNotice('')
    try {
      if (member) await removeRoleMember(workspaceId, member.role_id, member.user_id)
      else await cancelInvitation(id)
      setNotice(member ? `${member.name} removed from this workspace.` : 'Invitation removed. You can invite another user.')
      setRevision(value => value + 1)
      await access?.checkAccess()
    } catch (cause) {
      setActionError(roleErrorMessage(cause))
      setRevision(value => value + 1)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (!canRead) return <main className="p-6"><p role="alert">You do not have permission to view workspace users.</p></main>

  return (
    <main className="mx-auto max-w-7xl px-5 pt-3 pb-24 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Users</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Manage workspace users and invite people by email, including users from other workspaces.</p>
        </div>
        <Button disabled={!canInvite || loading || busy || Boolean(error) || invitations.length >= invitationLimit} onClick={() => setInviting(true)}>
          <Plus aria-hidden="true" /> Invite user
        </Button>
      </header>
      {inviting && canInvite && <InviteUserDialog workspaceId={workspaceId} isOwner={access?.isOwner ?? false} onClose={() => setInviting(false)} onSent={email => {
        setNotice(`Invitation sent to ${email}. They will join after accepting.`)
        setSection('invitations')
        setRevision(value => value + 1)
      }} />}
      {notice && <p role="status" className="mb-4 text-sm">{notice}</p>}
      {actionError && <p role="alert" className="mb-4 text-sm text-destructive">{actionError}</p>}
      {connectionError && <div className="mb-4 space-y-2"><p role="alert" className="text-sm text-destructive">{connectionError}</p><Button variant="outline" onClick={() => setConnectionAttempt(value => value + 1)}>Retry live updates</Button></div>}
      <div className="grid items-start gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="min-w-0 gap-5 rounded-lg border p-5 ring-0">
          <div><h2 className="text-xl font-semibold">People</h2><p className="mt-1 text-xs text-muted-foreground">Users and your pending invitations</p></div>
          <nav aria-label="Users sections" className="space-y-1">
            <Button variant="ghost" aria-pressed={section === 'users'} className={`h-auto w-full justify-start rounded-md border px-3 py-3 text-xs ${section === 'users' ? 'border-input bg-accent' : 'border-transparent'}`} onClick={() => setSection('users')}>
              <Users aria-hidden="true" /> Users <span className="ml-auto">{total}</span>
            </Button>
            <Button variant="ghost" aria-pressed={section === 'invitations'} className={`h-auto w-full justify-start rounded-md border px-3 py-3 text-xs ${section === 'invitations' ? 'border-input bg-accent' : 'border-transparent'}`} onClick={() => setSection('invitations')}>
              <Mail aria-hidden="true" /> Invitations <span className="ml-auto">{invitations.length}/{invitationLimit}</span>
            </Button>
          </nav>
          <p className="text-xs leading-5 text-muted-foreground">You can have 10 pending invitations across all workspaces. Acceptance, removal, or expiry frees a slot.</p>
        </Card>
        <Card className="min-w-0 gap-6 rounded-lg border p-5 ring-0 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-xl font-semibold">{section === 'users' ? 'Workspace users' : 'Your invitations'}</h2>
              <p className="mt-2 text-xs text-muted-foreground">{section === 'users' ? 'Removing a user revokes access to this workspace only.' : 'Pending invitations you sent across all workspaces. Invitations expire after 7 days.'}</p></div>
            <Button variant="outline" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>Refresh</Button>
          </div>
          {invitations.length >= invitationLimit && <p role="status" className="text-sm text-muted-foreground">You have reached 10 pending invitations. Wait for acceptance or remove an invitation to invite more users.</p>}
          {section === 'users' && <Input aria-label="Filter users" placeholder="Filter users by name or email" value={filter} onChange={event => setFilter(event.target.value)} />}
          {loading && <p role="status" className="text-sm text-muted-foreground">Loading users and invitations...</p>}
          {error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Try again</Button></div> : (
            <div ref={containerRef} className="max-h-105 overflow-y-auto" aria-label={section === 'users' ? 'Workspace users' : 'Pending invitations'}>
              <ul className="divide-y border-y">
                {section === 'users' ? members.map(member => (
                  <li key={member.user_id} className="flex items-center gap-3 py-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium" aria-hidden="true">{member.name.slice(0, 2).toUpperCase()}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={member.name}>{member.name}</p><p className="truncate font-mono text-xs text-muted-foreground" title={member.email}>{member.email}</p><p className="text-xs text-muted-foreground">{member.role_name}</p></div>
                    <Button variant="ghost" disabled={!canRemove || busy || loading} aria-label={`Remove ${member.name} from workspace`} onClick={() => { void remove(member.user_id, member) }}>Remove</Button>
                  </li>
                )) : invitations.map(invitation => (
                  <li key={invitation.id} className="flex items-center gap-3 py-4">
                    <Mail className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={invitation.email}>{invitation.email}</p><p className="truncate text-xs text-muted-foreground">{invitation.workspace_name} / {invitation.role_name}</p><p className="text-xs text-muted-foreground">{invitation.delivered_at ? 'Pending acceptance' : 'Email delivery pending'} · Expires {new Date(invitation.expires_at).toLocaleDateString()}</p></div>
                    <Button variant="ghost" disabled={busy || loading} aria-label={`Remove invitation to ${invitation.email}`} onClick={() => { void remove(invitation.id) }}>Remove</Button>
                  </li>
                ))}
              </ul>
              {!loading && (section === 'users' ? members.length === 0 : invitations.length === 0) && <p className="py-8 text-center text-sm text-muted-foreground">{section === 'users' ? 'No users found.' : 'No pending invitations.'}</p>}
              {section === 'users' && <><div ref={sentinelRef} className="h-1" />{hasMore && <Button variant="ghost" className="w-full" disabled={loading || busy} onClick={() => { void loadMore() }}>Load more users</Button>}</>}
            </div>
          )}
        </Card>
      </div>
    </main>
  )
}
