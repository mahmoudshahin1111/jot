import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getRoles, rolePageSize, type WorkspaceRole } from '@/lib/roles'
import { inviteEmailSchema, inviteWorkspaceUser } from '@/lib/invitations'
import { roleErrorMessage } from '@/hooks/use-workspace-roles'

export function InviteUserDialog({ workspaceId, isOwner, onClose, onSent }: {
  workspaceId: string
  isOwner: boolean
  onClose: () => void
  onSent: (email: string) => void
}) {
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [roles, setRoles] = useState<WorkspaceRole[]>([])
  const [cursor, setCursor] = useState<WorkspaceRole>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roleError, setRoleError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setRoleError(null)
      try {
        const page = await getRoles(workspaceId, '')
        if (!active) return
        const batch = page.roles.slice(0, rolePageSize)
        setRoles(batch.filter(role => isOwner || role.key !== 'workspace.owner'))
        setCursor(batch[batch.length - 1])
        setHasMore(page.roles.length > rolePageSize)
      } catch (cause) {
        if (active) setRoleError(roleErrorMessage(cause))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [workspaceId, isOwner, attempt])

  async function loadMore() {
    if (loading || saving) return
    setLoading(true)
    setRoleError(null)
    try {
      const page = await getRoles(workspaceId, '', cursor)
      const batch = page.roles.slice(0, rolePageSize)
      setRoles(previous => [...previous, ...batch.filter(role => isOwner || role.key !== 'workspace.owner')])
      setCursor(batch[batch.length - 1])
      setHasMore(page.roles.length > rolePageSize)
    } catch (cause) {
      setRoleError(roleErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    if (inFlight.current || loading || !roleId) return
    const result = inviteEmailSchema.safeParse(email)
    if (!result.success) { setError(result.error.issues[0].message); return }
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await inviteWorkspaceUser(workspaceId, roleId, result.data)
      onSent(result.data)
      onClose()
    } catch (cause) {
      setError(roleErrorMessage(cause))
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
          <Dialog.Title className="text-xl font-semibold">Invite user</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            Invite an existing or new Jot user by email. They keep their other workspaces and join this one only after accepting.
          </Dialog.Description>
          <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
            <fieldset disabled={saving} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <select id="invite-role" required className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={roleId} onChange={event => setRoleId(event.target.value)} disabled={loading}>
                  <option value="">Choose a role</option>
                  {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">A role without permissions grants no workspace access.</p>
                {loading && <p role="status" className="text-sm text-muted-foreground">Loading roles...</p>}
                {roleError && <p role="alert" className="text-sm text-destructive">{roleError}</p>}
                {hasMore && <Button type="button" variant="ghost" disabled={loading} onClick={() => { void loadMore() }}>Load more roles</Button>}
                {roleError && !hasMore && <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry roles</Button>}
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={saving || loading || !roleId || Boolean(roleError)}>{saving ? 'Sending...' : 'Send invitation'}</Button>
              </div>
            </fieldset>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
