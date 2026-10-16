import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { addRoleMember, getRoleMemberCandidates, rolePageSize, type RoleMemberCandidate } from '@/lib/roles'
import { roleErrorMessage } from '@/lib/roles'

export function AddRoleMembersDialog({ workspaceId, roleId, roleName, onClose, onAdded, checkAccess }: {
  workspaceId: string
  roleId: string
  roleName: string
  onClose: () => void
  onAdded: (member: RoleMemberCandidate) => void
  checkAccess: () => Promise<boolean>
}) {
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<RoleMemberCandidate[]>([])
  const [selected, setSelected] = useState<RoleMemberCandidate | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(filter.trim()), 250)
    return () => clearTimeout(timeout)
  }, [filter])

  useEffect(() => {
    const current = ++generation.current
    async function load() {
      setLoading(true)
      setSelected(null)
      setCandidates([])
      setError(null)
      setHasMore(false)
      try {
        const page = await getRoleMemberCandidates(workspaceId, roleId, search)
        if (current !== generation.current) return
        setCandidates(page.slice(0, rolePageSize))
        setHasMore(page.length > rolePageSize)
      } catch (cause) {
        if (current === generation.current) setError(roleErrorMessage(cause))
      } finally {
        if (current === generation.current) setLoading(false)
      }
    }
    void load()
    return () => { generation.current = current + 1 }
  }, [workspaceId, roleId, search, revision])

  async function loadMore() {
    if (loading || saving || !hasMore || error) return
    const current = generation.current
    setLoading(true)
    try {
      const page = await getRoleMemberCandidates(workspaceId, roleId, search, candidates[candidates.length - 1]?.user_id)
      if (current !== generation.current) return
      setCandidates(previous => [...previous, ...page.slice(0, rolePageSize)])
      setHasMore(page.length > rolePageSize)
    } catch (cause) {
      if (current === generation.current) setError(roleErrorMessage(cause))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  async function submit() {
    if (!selected || loading || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setActionError(null)
    try {
      await addRoleMember(workspaceId, roleId, selected)
      onAdded(selected)
      await checkAccess()
      onClose()
    } catch (cause) {
      setActionError(roleErrorMessage(cause))
      try { await checkAccess() } catch (accessError) { setError(roleErrorMessage(accessError)) }
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !inFlight.current) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <Dialog.Title className="truncate text-xl font-semibold" title={`Add members to ${roleName}`}>Add members to {roleName}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            Select an existing workspace user. Adding them replaces their current role and permissions. A role with no permissions grants no workspace access. To invite someone by email, open Settings / Users.
          </Dialog.Description>
          <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
            <Input aria-label="Search workspace users" placeholder="Search by name or email" value={filter} disabled={saving} onChange={event => setFilter(event.target.value)} />
            <fieldset disabled={saving} className="max-h-64 space-y-2 overflow-y-auto">
              <legend className="sr-only">Choose a workspace user</legend>
              {candidates.map(member => (
                <label key={member.user_id} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border p-3">
                  <input type="radio" name="workspace-user" checked={selected?.user_id === member.user_id} onChange={() => setSelected(member)} className="shrink-0 accent-primary" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium" title={member.name}>{member.name}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={member.email}>{member.email}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={member.role_name}>Current role: {member.role_name}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {loading && <p role="status" className="text-sm text-muted-foreground">Loading workspace users...</p>}
            {!loading && !error && candidates.length === 0 && <p className="text-sm text-muted-foreground">No eligible workspace users found.</p>}
            {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" disabled={saving} onClick={() => setRevision(value => value + 1)}>Try again</Button></div>}
            {hasMore && !error && <Button type="button" variant="ghost" disabled={loading || saving} onClick={() => { void loadMore() }}>Load more users</Button>}
            {actionError && <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">{actionError}</p>
              <Button type="button" variant="outline" disabled={saving} onClick={() => {
                setActionError(null)
                setRevision(value => value + 1)
              }}>Refresh users</Button>
            </div>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!selected || loading || saving || Boolean(error)}>{saving ? 'Adding...' : 'Add member'}</Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
