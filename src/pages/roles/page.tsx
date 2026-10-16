import { useState, type ReactElement } from 'react'
import { useParams } from 'react-router-dom'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Tooltip } from '@base-ui/react/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { RoleMembers } from './components/role-members'
import { CreateRoleDialog } from './components/create-role-dialog'
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll'
import { useWorkspaceRoles } from './hooks/use-workspace-roles'
import { useRoleTabs } from './hooks/use-role-tabs'

const roleHasMembersMessage = "You can't delete a role assigned to members. Move all members to another role before deleting it."

function RoleBadge({ system }: { system: boolean }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${system ? 'border border-input' : 'bg-muted'}`}>
      {system ? 'System' : 'Custom'}
    </span>
  )
}

// Disabled controls do not receive pointer events, so the wrapper is the hover/focus target.
function DisabledReasonTooltip({ reason, label, children }: {
  reason: string | null
  label: string
  children: ReactElement
}) {
  if (!reason) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span />}
        tabIndex={0}
        aria-label={label}
        className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup role="tooltip" className="z-50 max-w-64 rounded-md bg-foreground px-3 py-2 text-xs text-background shadow-md">
            {reason}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function PermissionToggle({ name, checked, disabled, reason, onChange }: {
  name: string
  checked: boolean
  disabled: boolean
  reason: string | null
  onChange: () => void
}) {
  return (
    <DisabledReasonTooltip reason={reason} label={`Allow ${name}: editing unavailable`}>
      <input
        type="checkbox"
        className={`size-4 cursor-pointer accent-primary disabled:cursor-not-allowed ${reason ? 'pointer-events-none' : ''}`}
        checked={checked}
        disabled={disabled}
        aria-label={`Allow ${name}`}
        onChange={onChange}
      />
    </DisabledReasonTooltip>
  )
}

export function RolesPage() {
  const { workspaceId } = useParams()
  if (!workspaceId) return <p role="alert">Workspace ID is required.</p>
  return <WorkspaceRoles key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceRoles({ workspaceId }: { workspaceId: string }) {
  const state = useWorkspaceRoles(workspaceId)
  const { containerRef, sentinelRef } = useInfiniteScroll(() => { void state.loadMore() }, state.hasMore && !state.loading && !state.error)
  const { tab, setTab, handleKeyDown } = useRoleTabs()
  const role = state.selectedRole
  const canEdit = role !== null && state.canEditRole(role)
  const permissionEditReason = state.selfRoleEditBlocked
    ? 'You cannot update a role assigned to you. Only the workspace owner can do this.'
    : null
  const deleteBlockedReason = !role ? null
    : role.is_system ? 'System roles cannot be deleted.'
    : !state.metadata?.capabilities.delete ? 'You need roles.delete permission to delete roles.'
    : role.member_count > 0 ? roleHasMembersMessage
    : null
  const actionError = state.actionErrorCode === '23514' ? roleHasMembersMessage : state.actionError
  const [creating, setCreating] = useState(false)
  const visibleRoles = role && !state.searching && !state.roles.some(item => item.id === role.id)
    ? [role, ...state.roles]
    : state.roles

  return (
    <main className="mx-auto max-w-7xl px-5 pt-3 pb-24 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Roles and permissions</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Choose what each role can see and do. Changes apply to everyone assigned to the role.
          </p>
        </div>
        <Button
          disabled={state.busy || state.loading || Boolean(state.error) || !state.metadata?.capabilities.create}
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden="true" /> Create role
        </Button>
      </header>
      <CreateRoleDialog
        open={creating}
        onOpenChange={setCreating}
        busy={state.busy}
        error={actionError}
        onCreate={async name => {
          const created = await state.create(name)
          if (created) setTab('permissions')
          return created
        }}
      />
      {state.notice && <p role="status" className="mb-4 text-sm">{state.notice}</p>}
      {actionError && !creating && <p role="alert" className="mb-4 text-sm text-destructive">{actionError}</p>}
      <div className="grid items-start gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="min-w-0 gap-5 rounded-lg border p-5 ring-0">
          <div>
            <h2 className="text-xl font-semibold">Roles</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {state.metadata?.total ?? 0} {state.searching ? 'matching roles' : 'roles in this workspace'}
            </p>
          </div>
          <Input
            placeholder="Filter roles"
            aria-label="Filter roles"
            value={state.filter}
            onChange={event => state.setFilter(event.target.value)}
          />
          <div ref={containerRef} className="max-h-95 overflow-y-auto" aria-label="Workspace roles">
            <ul className="space-y-1">
              {visibleRoles.map(item => (
                <li key={item.id}>
                  <Button
                    variant="ghost"
                    className={`h-auto w-full justify-between rounded-md border px-3 py-3 text-left ${role?.id === item.id ? 'border-input bg-accent' : 'border-transparent'}`}
                    aria-pressed={role?.id === item.id}
                    disabled={state.busy}
                    onClick={() => state.selectRole(item)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold" title={item.name}>{item.name}</span>
                      <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                        {item.member_count} {item.member_count === 1 ? 'member' : 'members'}
                      </span>
                    </span>
                    <RoleBadge system={item.is_system} />
                  </Button>
                </li>
              ))}
            </ul>
            {state.loading && <p role="status" className="py-4 text-sm text-muted-foreground">Loading roles...</p>}
            {state.error && (
              <div className="space-y-3 py-4">
                <p role="alert" className="text-sm text-destructive">{state.error}</p>
                <Button variant="outline" onClick={state.retry}>Try again</Button>
              </div>
            )}
            {!state.loading && !state.error && state.roles.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">No roles found.</p>
            )}
            <div ref={sentinelRef} className="h-1" />
            {state.hasMore && <Button variant="ghost" className="w-full" disabled={state.loading} onClick={() => { void state.loadMore() }}>Load more roles</Button>}
          </div>
        </Card>
        {role && state.metadata && !state.error ? (
          <Card className="min-w-0 gap-6 rounded-lg border p-5 ring-0 sm:p-6">
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-3">
                  <h2 className="min-w-0 truncate text-xl font-semibold" title={role.name}>{role.name}</h2>
                  <RoleBadge system={role.is_system} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {role.is_system ? 'System role. Permissions are read-only; duplicate this role to customize it.' : 'Custom role for this workspace. Manage its permissions and members below.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={state.busy || !state.metadata.capabilities.create} onClick={state.duplicate}>
                  <Copy aria-hidden="true" /> Duplicate role
                </Button>
                <DisabledReasonTooltip reason={deleteBlockedReason} label={`Delete role unavailable. ${deleteBlockedReason}`}>
                  <Button
                    variant="destructive"
                    disabled={state.busy || !state.canDeleteRole(role)}
                    onClick={state.removeRole}
                  >
                    <Trash2 aria-hidden="true" /> Delete role
                  </Button>
                </DisabledReasonTooltip>
              </div>
            </div>
            <div className="flex w-fit gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Role details">
              {(['permissions', 'members'] as const).map(value => (
                <Button
                  key={value}
                  variant="ghost"
                  role="tab"
                  id={`${value}-tab`}
                  aria-controls={`${value}-panel`}
                  aria-selected={tab === value}
                  tabIndex={tab === value ? 0 : -1}
                  className={tab === value ? 'bg-background shadow-sm' : 'text-muted-foreground'}
                  onClick={() => setTab(value)}
                  onKeyDown={event => handleKeyDown(event, value)}
                >
                  {value === 'permissions' ? 'Permissions' : `Members ${role.member_count}`}
                </Button>
              ))}
            </div>
            {state.dirty && (
              <div role="status" className="grid min-w-0 items-center gap-3 rounded-md border bg-muted p-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <p className="min-w-0 truncate text-xs font-medium" title={`You have unsaved changes to ${role.name}.`}>You have unsaved changes to {role.name}.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={state.busy} onClick={state.discard}>Discard changes</Button>
                  <Button disabled={state.busy || !canEdit} onClick={state.save}>{state.busy ? 'Saving...' : 'Save changes'}</Button>
                </div>
              </div>
            )}
            {tab === 'permissions' ? (
              <div role="tabpanel" id="permissions-panel" aria-labelledby="permissions-tab" className="overflow-x-auto">
                <Tooltip.Provider>
                  <table className="w-full table-fixed text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th scope="col" className="pb-3 font-normal">Permission</th>
                        <th scope="col" className="w-24 pb-3 text-center font-normal">Allowed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {state.metadata.permissions.map(permission => (
                        <tr key={permission.id}>
                          <th scope="row" className="py-3 pr-4 font-normal">
                            <span className="block truncate font-medium" title={permission.name}>{permission.name}</span>
                            <span className="mt-1 block break-words text-xs text-muted-foreground">{permission.description}</span>
                          </th>
                          <td className="py-3 text-center">
                            <PermissionToggle
                              name={permission.name}
                              checked={state.draft.includes(permission.id)}
                              disabled={!canEdit || state.busy}
                              reason={permissionEditReason}
                              onChange={() => state.togglePermission(permission.id)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Tooltip.Provider>
                {permissionEditReason
                  ? <p className="mt-3 text-xs text-muted-foreground">{permissionEditReason}</p>
                  : !role.is_system && !canEdit && <p className="mt-3 text-xs text-muted-foreground">You need roles.update permission to edit this role.</p>}
              </div>
            ) : (
              <RoleMembers
                key={role.id}
                workspaceId={workspaceId}
                roleId={role.id}
                roleName={role.name}
                canRemove={state.metadata.capabilities.remove_members && !state.busy}
                canAdd={state.metadata.capabilities.add_members && !state.busy}
                updateCount={state.updateMemberCount}
                refreshRoles={state.refreshRoles}
                checkAccess={state.checkAccess}
              />
            )}
          </Card>
        ) : !state.loading && !state.error ? (
          <Card className="border p-8 text-center text-muted-foreground ring-0">Select a role to manage its permissions and members.</Card>
        ) : null}
      </div>
    </main>
  )
}
