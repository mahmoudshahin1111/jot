import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getWorkspaceAccess, type Workspace } from '@/lib/workspaces'
import { supabase } from '@/lib/supabaseClient'

export const WorkspaceNavigationContext = createContext<{
  registerGuard: (guard: () => boolean) => () => void
  checkAccess: () => Promise<boolean>
  permissions: string[]
} | null>(null)

export function useWorkspaceShell(workspaceId: string) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const pathnameRef = useRef(pathname)
  const checkedPathRef = useRef(pathname)
  useEffect(() => { pathnameRef.current = pathname }, [pathname])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [permissions, setPermissions] = useState<string[]>([])
  const guardRef = useRef<(() => boolean) | null>(null)
  const activeRef = useRef(false)
  const requestRef = useRef(Symbol())

  const registerGuard = useCallback((guard: () => boolean) => {
    guardRef.current = guard
    return () => {
      if (guardRef.current === guard) guardRef.current = null
    }
  }, [])

  const confirmNavigation = useCallback(() => guardRef.current?.() ?? true, [])

  const checkAccess = useCallback(async () => {
    const request = Symbol()
    requestRef.current = request
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw sessionError
    if (!activeRef.current || request !== requestRef.current) return false
    if (!data.session) {
      navigate('/login', { replace: true })
      return false
    }
    const result = await getWorkspaceAccess(workspaceId)
    if (!activeRef.current || request !== requestRef.current) return false
    if (!result) {
      navigate('/workspaces', { replace: true })
      return false
    }
    if (!result.permissions.includes('roles.read')
      && pathnameRef.current === `/workspaces/${workspaceId}/settings/roles`) {
      navigate(`/workspaces/${workspaceId}/dashboard`, { replace: true })
    }
    setWorkspace(result)
    setPermissions(result.permissions)
    setError(null)
    return true
  }, [navigate, workspaceId])

  useEffect(() => {
    let active = true
    activeRef.current = true
    let channel: ReturnType<typeof supabase.channel> | undefined
    let subscribedUserId: string | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    async function verify() {
      try {
        await checkAccess()
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load this workspace.')
      }
    }
    function scheduleVerification() {
      clearTimeout(timeout)
      timeout = setTimeout(() => { void verify() }, 50)
    }
    async function subscribe() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!active) return
        if (!data.session) {
          navigate('/login', { replace: true })
          return
        }
        await supabase.realtime.setAuth(data.session.access_token)
        if (!active) return
        subscribedUserId = data.session.user.id
        channel = supabase.channel(`workspace-access:${data.session.user.id}`, {
          config: { private: true },
        }).on('broadcast', { event: 'access_changed' }, ({ payload }) => {
          if (payload?.workspace_id === workspaceId) scheduleVerification()
        }).subscribe((status, cause) => {
          if (!active) return
          if (status === 'SUBSCRIBED') {
            setConnectionError(null)
            scheduleVerification()
          }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConnectionError(cause?.message ?? 'Workspace access connection lost. Please retry.')
          }
        })
      } catch (cause) {
        if (active) setConnectionError(cause instanceof Error ? cause.message : 'Unable to subscribe to workspace access changes.')
      }
    }
    void verify()
    void subscribe()
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') navigate('/login', { replace: true })
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (subscribedUserId && session?.user.id !== subscribedUserId) setAttempt(value => value + 1)
        else scheduleVerification()
      }
    })
    window.addEventListener('focus', scheduleVerification)
    return () => {
      active = false
      activeRef.current = false
      requestRef.current = Symbol()
      clearTimeout(timeout)
      authListener.subscription.unsubscribe()
      window.removeEventListener('focus', scheduleVerification)
      if (channel) {
        void supabase.removeChannel(channel).then(status => {
          if (status !== 'ok') console.error('Unable to close workspace access connection:', status)
        }).catch(cause => console.error('Unable to close workspace access connection:', cause))
      }
    }
  }, [attempt, checkAccess, navigate, workspaceId])

  useEffect(() => {
    if (checkedPathRef.current === pathname) return
    checkedPathRef.current = pathname
    void checkAccess().catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to verify workspace access.'))
  }, [pathname, checkAccess])

  return { workspace, error: error ?? connectionError, registerGuard, confirmNavigation, checkAccess, permissions, retry: () => setAttempt(value => value + 1) }
}
