import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { WorkspaceNavigationContext } from '@/hooks/use-workspace-shell'
import {
  deleteRole, duplicateRole, getRoles, rolePageSize, saveRolePermissions,
  type RolesPage, type WorkspaceRole,
} from '@/lib/roles'

export function roleErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Unable to complete the role action. Please try again.'
}

export function useWorkspaceRoles(workspaceId: string) {
  const navigate = useNavigate()
  const navigation = useContext(WorkspaceNavigationContext)
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
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const fetching = useRef(false)
  const actionInFlight = useRef(false)
  const selectedRef = useRef(selectedRole)
  useEffect(() => { selectedRef.current = selectedRole }, [selectedRole])
  const dirty = selectedRole !== null && (
    draft.length !== selectedRole.permission_ids.length
    || draft.some(id => !selectedRole.permission_ids.includes(id))
  )

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

  const checkAccess = useCallback(async () => {
    const { data: session, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw sessionError
    if (!session.session) {
      navigate('/login', { replace: true })
      return false
    }
    const { data, error: membershipError } = await supabase.from('workspace_users')
      .select('user_id').eq('workspace_id', workspaceId).eq('user_id', session.session.user.id).maybeSingle()
    if (membershipError) throw membershipError
    if (!data) {
      navigate('/workspaces', { replace: true })
      return false
    }
    return true
  }, [navigate, workspaceId])

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
        if (!await checkAccess()) return
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

  useEffect(() => {
    function verify() {
      void checkAccess().catch(cause => setError(roleErrorMessage(cause)))
    }
    const timer = setInterval(verify, 15000)
    window.addEventListener('focus', verify)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', verify)
    }
  }, [checkAccess])

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
  }

  function togglePermission(id: string) {
    if (busy || selectedRole?.is_system || !metadata?.capabilities.update) return
    setDraft(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])
    setNotice('')
  }

  function discard() {
    if (busy) return
    setDraft(selectedRole?.permission_ids ?? [])
    setNotice('Changes discarded.')
    setActionError(null)
  }

  async function runAction(action: () => Promise<void>) {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setBusy(true)
    setNotice('')
    setActionError(null)
    try {
      await action()
    } catch (cause) {
      setActionError(roleErrorMessage(cause))
      try { await checkAccess() } catch (accessError) { setError(roleErrorMessage(accessError)) }
    } finally {
      actionInFlight.current = false
      setBusy(false)
    }
  }

  function save() {
    if (!selectedRole || !dirty) return
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
    if (!selectedRole || (dirty && !window.confirm('Duplicate the saved role? Unsaved changes will be discarded.'))) return
    const role = selectedRole
    void runAction(async () => {
      const copy = await duplicateRole(workspaceId, role.id)
      setSelectedRole(copy)
      setDraft(copy.permission_ids)
      setFilter('')
      setRevision(value => value + 1)
      setNotice('Role duplicated without members.')
    })
  }

  function removeRole() {
    if (!selectedRole || selectedRole.is_system
      || !window.confirm(`Delete ${selectedRole.label}? This cannot be undone.`)) return
    const role = selectedRole
    void runAction(async () => {
      await deleteRole(workspaceId, role.id)
      setSelectedRole(null)
      selectedRef.current = null
      setDraft([])
      setRevision(value => value + 1)
      setNotice('Role deleted.')
    })
  }

  const updateMemberCount = useCallback((roleId: string, count: number) => {
    setRoles(previous => previous.map(role => role.id === roleId ? { ...role, member_count: count } : role))
    setSelectedRole(previous => previous?.id === roleId ? { ...previous, member_count: count } : previous)
  }, [])

  return {
    roles, metadata, selectedRole, draft, dirty, filter, setFilter, loading, hasMore,
    error, actionError, busy, notice, loadMore, selectRole, togglePermission, discard, save, duplicate,
    searching: search !== '',
    confirmLeave: () => !dirty || window.confirm('Discard unsaved permission changes and leave this page?'),
    removeRole, updateMemberCount, checkAccess,
    retry: () => setRevision(value => value + 1),
  }
}
