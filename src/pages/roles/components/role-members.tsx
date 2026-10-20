import { useState } from 'react'
import { Plus } from 'lucide-react'
import { AddRoleMembersDialog } from './add-role-members-dialog'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/user-avatar'
import { InfiniteScroll } from '@/components/infinite-scroll'
import { useRoleMembers } from '../hooks/use-role-members'

export function RoleMembers({
  workspaceId, roleId, roleName, canRemove, canAdd, updateCount, refreshRoles, checkAccess,
}: {
  workspaceId: string
  roleId: string
  roleName: string
  canRemove: boolean
  canAdd: boolean
  updateCount: (roleId: string, count: number) => void
  refreshRoles: () => void
  checkAccess: () => Promise<boolean>
}) {
  const members = useRoleMembers(workspaceId, roleId, updateCount, checkAccess)
  const [adding, setAdding] = useState(false)
  const [addedNotice, setAddedNotice] = useState('')

  return (
    <div role="tabpanel" id="members-panel" aria-labelledby="members-tab">
      <div className="mb-4 grid min-w-0 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <p className="min-w-0 truncate text-sm text-muted-foreground" title={`${members.total ?? '...'} people have the ${roleName} role`}>{members.total ?? '...'} people have the {roleName} role</p>
        <Button variant="outline" disabled={!canAdd || members.loading || members.removing !== null} onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" /> Add members
        </Button>
      </div>
      {adding && <AddRoleMembersDialog
        workspaceId={workspaceId}
        roleId={roleId}
        roleName={roleName}
        onClose={() => setAdding(false)}
        onAdded={member => {
          setAddedNotice(`${member.name} assigned to ${roleName}.`)
          members.refresh()
          refreshRoles()
        }}
        checkAccess={checkAccess}
      />}
      <p className="mb-3 text-xs text-muted-foreground">Removing a member revokes their access to this workspace only.</p>
      {members.notice && <p role="status" className="mb-3 text-sm">{members.notice}</p>}
      {addedNotice && <p role="status" className="mb-3 text-sm">{addedNotice}</p>}
      {members.actionError && <p role="alert" className="mb-3 text-sm text-destructive">{members.actionError}</p>}
      {members.countError && <div className="mb-3 space-y-2">
        <p role="alert" className="text-sm text-destructive">Unable to load the total: {members.countError}</p>
        <Button variant="outline" onClick={members.retryCount}>Retry count</Button>
      </div>}
      <InfiniteScroll
        className="max-h-105 overflow-y-auto"
        aria-label="Role members"
        enabled={members.hasMore && !members.loading && !members.error && !members.removing}
        onLoadMore={members.loadMore}
        footer={members.hasMore && (
          <Button variant="ghost" className="w-full" disabled={members.loading || members.removing !== null} onClick={members.loadMore}>
            Load more members
          </Button>
        )}
      >
        <ul className="divide-y border-y">
          {members.members.map(member => (
            <li key={member.user_id} className="flex items-center gap-3 py-4">
              <UserAvatar text={member.name} imagePath={member.avatar_path} userId={member.user_id} decorative />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={member.name}>{member.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={member.email}>{member.email}</p>
              </div>
              <Button
                variant="ghost"
                disabled={!canRemove || members.loading || members.removing !== null}
                aria-label={`Remove ${member.name} from workspace`}
                onClick={() => {
                  setAddedNotice('')
                  void members.remove(member)
                }}
              >
                {members.removing === member.user_id ? 'Removing...' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
        {!members.loading && !members.error && members.members.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No members assigned to this role.</p>
        )}
        {members.loading && <p role="status" className="py-4 text-sm text-muted-foreground">Loading members...</p>}
        {members.error && (
          <div className="space-y-3 py-4">
            <p role="alert" className="text-sm text-destructive">{members.error}</p>
            <Button variant="outline" onClick={members.retry}>Try again</Button>
          </div>
        )}
      </InfiniteScroll>
    </div>
  )
}
