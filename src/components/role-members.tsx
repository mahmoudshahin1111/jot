import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll'
import { useRoleMembers } from '@/hooks/use-role-members'

export function RoleMembers({
  workspaceId, roleId, roleName, canRemove, updateCount, checkAccess,
}: {
  workspaceId: string
  roleId: string
  roleName: string
  canRemove: boolean
  updateCount: (roleId: string, count: number) => void
  checkAccess: () => Promise<boolean>
}) {
  const members = useRoleMembers(workspaceId, roleId, updateCount, checkAccess)
  const { containerRef, sentinelRef } = useInfiniteScroll(members.loadMore, members.hasMore && !members.loading && !members.error && !members.removing)

  return (
    <div role="tabpanel" id="members-panel" aria-labelledby="members-tab">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{members.total} people have the {roleName} role</p>
        <Button variant="outline" disabled title="Adding members is coming in a later ticket">
          <Plus aria-hidden="true" /> Add members
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Removing a member revokes their access to this workspace only.</p>
      {members.notice && <p role="status" className="mb-3 text-sm">{members.notice}</p>}
      {members.actionError && <p role="alert" className="mb-3 text-sm text-destructive">{members.actionError}</p>}
      <div ref={containerRef} className="max-h-105 overflow-y-auto" aria-label="Role members">
        <ul className="divide-y border-y">
          {members.members.map(member => (
            <li key={member.user_id} className="flex items-center gap-3 py-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium" aria-hidden="true">
                {member.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{member.email}</p>
              </div>
              <Button
                variant="ghost"
                disabled={!canRemove || members.loading || members.removing !== null}
                aria-label={`Remove ${member.name} from workspace`}
                onClick={() => { void members.remove(member) }}
              >
                {members.removing === member.user_id ? 'Removing...' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
        {!members.loading && !members.error && members.total === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No members assigned to this role.</p>
        )}
        {members.loading && <p role="status" className="py-4 text-sm text-muted-foreground">Loading members...</p>}
        {members.error && (
          <div className="space-y-3 py-4">
            <p role="alert" className="text-sm text-destructive">{members.error}</p>
            <Button variant="outline" onClick={members.retry}>Try again</Button>
          </div>
        )}
        <div ref={sentinelRef} className="h-1" />
        {members.hasMore && (
          <Button variant="ghost" className="w-full" disabled={members.loading || members.removing !== null} onClick={members.loadMore}>
            Load more members
          </Button>
        )}
      </div>
    </div>
  )
}
