import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { WorkspaceNavigationContext } from '@/hooks/use-workspace-shell'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { useWorkspaceAccess } from '@/hooks/use-workspace-access'
import { useRecordCount } from '@/hooks/use-record-count'
import { PERMISSIONS } from '@/lib/permissions'
import {
  countRoleMembers, countRoles, createRole, deleteRole, duplicateRole, getRoles, roleErrorMessage, rolePageSize, saveRolePermissions,
  type RolesPage, type WorkspaceRole,
} from '@/lib/roles'

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

export function useWorkspaceRoles(workspaceId: string) {
  const navigation = useContext(WorkspaceNavigationContext)
  const { hasPermission } = useWorkspacePermissions()
  const { workspace, checkAccess } = useWorkspaceAccess()
  if (!navigation) throw new Error('Workspace roles require a workspace shell.')
  const [roles, setRoles] = useState<WorkspaceRole[]>([])
  const [metadata, setMetadata] = useState<Omit<RolesPage, 'roles'> | null>(null)
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole | null>(null)
  const [draft, setDraft] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionErrorCode, setActionErrorCode] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [countRevision, setCountRevision] = useState(0)
  const loadCount = useCallback(() => countRoles(workspaceId, search), [workspaceId, search])
  const count = useRecordCount(loadCount, hasPermission(PERMISSIONS.roles.read), countRevision)
  const generation = useRef(0)
  const fetching = useRef(false)
  const actionInFlight = useRef(false)
  const selectedRef = useRef(selectedRole)
  useEffect(() => { selectedRef.current = selectedRole }, [selectedRole])
  const dirty = selectedRole !== null && (
    draft.length !== selectedRole.permission_ids.length
    || draft.some(id => !selectedRole.permission_ids.includes(id))
  )
  const selfRoleEditBlocked = selectedRole !== null && selectedRole.id === workspace?.role_id && !workspace.is_owner
  function canEditRole(role: WorkspaceRole) {
    return !role.is_system && hasPermission(PERMISSIONS.roles.update)
      && (role.id !== workspace?.role_id || workspace.is_owner)
  }

  function canDeleteRole(role: WorkspaceRole) {
    return !role.is_system && hasPermission(PERMISSIONS.roles.delete) && role.member_count === 0
  }

  useEffect(() => {
    if (!navigation) return
    return navigation.registerGuard(() => !busy && (
      !dirty || window.confirm('Discard unsaved permission changes and leave this page?')
    ))
  }, [busy, dirty, navigation])

  useEffect(() => {
    if (!dirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(filter.trim()), 250)
    return () => clearTimeout(timeout)
  }, [filter])

  useEffect(() => {
    const current = ++generation.current
    async function load() {
      fetching.current = true
      setLoading(true)
      setError(null)
      setRoles([])
      setHasMore(false)
      try {
        const page = await getRoles(workspaceId, search)
        if (generation.current !== current) return
        setRoles(page.roles.slice(0, rolePageSize))
        setHasMore(page.roles.length > rolePageSize)
        setMetadata(page)
        if (!selectedRef.current) {
          const first = page.roles[0] ?? null
          setSelectedRole(first)
          setDraft(first?.permission_ids ?? [])
        }
      } catch (cause) {
        if (generation.current === current) setError(roleErrorMessage(cause))
      } finally {
        if (generation.current === current) {
          fetching.current = false
          setLoading(false)
        }
      }
    }
    const timeout = setTimeout(() => { void load() }, 0)
    return () => {
      clearTimeout(timeout)
      generation.current = current + 1
    }
  }, [checkAccess, revision, search, workspaceId])

  const loadMore = useCallback(async () => {
    if (fetching.current || !hasMore || error || roles.length === 0) return
    fetching.current = true
    setLoading(true)
    const current = generation.current
    try {
      const page = await getRoles(workspaceId, search, roles[roles.length - 1])
      if (generation.current !== current) return
      setRoles(previous => [...previous, ...page.roles.slice(0, rolePageSize)])
      setHasMore(page.roles.length > rolePageSize)
      setMetadata(page)
    } catch (cause) {
      if (generation.current === current) setError(roleErrorMessage(cause))
    } finally {
      if (generation.current === current) {
        fetching.current = false
        setLoading(false)
      }
    }
  }, [error, hasMore, roles, search, workspaceId])

  function selectRole(role: WorkspaceRole) {
    if (busy || (dirty && !window.confirm('Discard unsaved permission changes and switch roles?'))) return
    setSelectedRole(role)
    setDraft(role.permission_ids)
    setNotice('')
    setActionError(null)
    setActionErrorCode(null)
  }

  function togglePermission(id: string) {
    if (busy || !selectedRole || !canEditRole(selectedRole)) return
    setDraft(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])
    setNotice('')
  }

  function discard() {
    if (busy) return
    setDraft(selectedRole?.permission_ids ?? [])
    setNotice('Changes discarded.')
    setActionError(null)
    setActionErrorCode(null)
  }

  async function runAction(action: () => Promise<void>) {
    if (actionInFlight.current) return false
    actionInFlight.current = true
    setBusy(true)
    setNotice('')
    setActionError(null)
    setActionErrorCode(null)
    try {
      await action()
      return true
    } catch (cause) {
      setActionError(roleErrorMessage(cause))
      setActionErrorCode(errorCode(cause))
      try { await checkAccess() } catch (accessError) { setError(roleErrorMessage(accessError)) }
      return false
    } finally {
      actionInFlight.current = false
      setBusy(false)
    }
  }

  async function create(name: string) {
    if (!hasPermission(PERMISSIONS.roles.create)) {
      setActionError('You do not have permission to create roles.')
      setActionErrorCode(null)
      return false
    }
    if (dirty && !window.confirm('Discard unsaved permission changes and create a role?')) return false
    return runAction(async () => {
      const role = await createRole(workspaceId, name)
      selectedRef.current = role
      setSelectedRole(role)
      setDraft(role.permission_ids)
      setFilter('')
      setRevision(value => value + 1)
      setCountRevision(value => value + 1)
      setNotice('Role created. You can now manage its permissions and members.')
    })
  }

  function save() {
    if (!selectedRole || !dirty || !canEditRole(selectedRole)) return
    const role = selectedRole
    void runAction(async () => {
      await saveRolePermissions(workspaceId, role, draft)
      const updated = { ...role, permission_ids: [...draft] }
      setSelectedRole(updated)
      setRoles(previous => previous.map(item => item.id === role.id ? updated : item))
      setNotice('Role permissions saved.')
      await checkAccess()
    })
  }

  function duplicate() {
    if (!hasPermission(PERMISSIONS.roles.duplicate)) {
      setActionError('You do not have permission to duplicate roles.')
      setActionErrorCode(null)
      return
    }
    if (!selectedRole || (dirty && !window.confirm('Duplicate the saved role? Unsaved changes will be discarded.'))) return
    const role = selectedRole
    void runAction(async () => {
      const copy = await duplicateRole(workspaceId, role.id)
      setSelectedRole(copy)
      setDraft(copy.permission_ids)
      setFilter('')
      setRevision(value => value + 1)
      setCountRevision(value => value + 1)
      setNotice('Role duplicated without members.')
    })
  }

  function removeRole() {
    if (busy || !selectedRole || !canDeleteRole(selectedRole)) return
    if (!window.confirm(`Delete ${selectedRole.name}? This cannot be undone.`)) return
    const role = selectedRole
    void runAction(async () => {
      try {
        await deleteRole(workspaceId, role.id)
      } catch (cause) {
        if (errorCode(cause) !== '23514') throw cause
        // The visible member count was stale; refresh it so the button locks.
        const total = await countRoleMembers(workspaceId, role.id)
        updateMemberCount(role.id, total)
        throw cause
      }
      setSelectedRole(null)
      selectedRef.current = null
      setDraft([])
      setRevision(value => value + 1)
      setCountRevision(value => value + 1)
      setNotice('Role deleted.')
    })
  }

  const updateMemberCount = useCallback((roleId: string, count: number) => {
    setRoles(previous => previous.map(role => role.id === roleId ? { ...role, member_count: count } : role))
    setSelectedRole(previous => previous?.id === roleId ? { ...previous, member_count: count } : previous)
  }, [])

  return {
    roles, metadata: metadata && {
      ...metadata,
      total: count.total,
      capabilities: {
        update: hasPermission(PERMISSIONS.roles.update),
        create: hasPermission(PERMISSIONS.roles.create),
        duplicate: hasPermission(PERMISSIONS.roles.duplicate),
        delete: hasPermission(PERMISSIONS.roles.delete),
        remove_members: hasPermission(PERMISSIONS.roles.removeMembers),
        add_members: hasPermission(PERMISSIONS.roles.addMembers),
      },
    }, selectedRole, draft, dirty, canEditRole, canDeleteRole, selfRoleEditBlocked, filter, setFilter, loading, hasMore,
    error, countError: count.error, retryCount: count.refresh,
    actionError, actionErrorCode, busy, notice, loadMore, selectRole, togglePermission, discard, save, duplicate,
    searching: search !== '',
    confirmLeave: () => !dirty || window.confirm('Discard unsaved permission changes and leave this page?'),
    create, removeRole, updateMemberCount, checkAccess,
    refreshRoles: () => setRevision(value => value + 1),
    retry: () => { setRevision(value => value + 1); count.refresh() },
  }
}
