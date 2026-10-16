import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWorkspaceAccessState } from '@/hooks/use-workspace-access'
import { supabase } from '@/lib/supabaseClient'
import { PERMISSIONS } from '@/lib/permissions'

export const WorkspaceNavigationContext = createContext<{
  registerGuard: (guard: () => boolean) => () => void
} | null>(null)

export function useWorkspaceShell(workspaceId: string) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const checkedPathRef = useRef(pathname)
  const access = useWorkspaceAccessState(workspaceId)
  const { checkAccess, hasPermission } = access
  const [error, setError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const logoutInFlight = useRef(false)
  const guardRef = useRef<(() => boolean) | null>(null)

  const registerGuard = useCallback((guard: () => boolean) => {
    guardRef.current = guard
    return () => {
      if (guardRef.current === guard) guardRef.current = null
    }
  }, [])

  const confirmNavigation = useCallback(() => guardRef.current?.() ?? true, [])

  async function logout() {
    if (logoutInFlight.current || !confirmNavigation()) return
    logoutInFlight.current = true
    setLoggingOut(true)
    setLogoutError(null)
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) throw signOutError
      navigate('/login', { replace: true })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to log out. Please try again.'
      setLogoutError(message)
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) setLogoutError(`${message} ${sessionError.message}`)
      else if (!data.session) {
        navigate('/login', {
          replace: true,
          state: { logoutError: `You are logged out on this browser, but server sign-out failed: ${message}` },
        })
      }
    } finally {
      logoutInFlight.current = false
      setLoggingOut(false)
    }
  }

  useEffect(() => {
    if (access.status === 'signed-out' && !logoutInFlight.current) {
      navigate('/login', { replace: true })
    } else if (access.status === 'unavailable') {
      navigate('/workspaces', { replace: true })
    } else if (access.status === 'ready' && !hasPermission(PERMISSIONS.roles.read)
      && (pathname === `/workspaces/${workspaceId}/settings/roles`
        || pathname === `/workspaces/${workspaceId}/settings/users`)) {
      navigate(`/workspaces/${workspaceId}/dashboard`, { replace: true })
    }
  }, [access.status, hasPermission, navigate, pathname, workspaceId])

  useEffect(() => {
    if (checkedPathRef.current === pathname) return
    checkedPathRef.current = pathname
    void checkAccess().then(() => setError(null)).catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to verify workspace access.'))
  }, [pathname, checkAccess])

  return {
    workspace: access.workspace, error: error ?? access.error, hasPermission, checkAccess,
    registerGuard, confirmNavigation, logout, loggingOut, logoutError,
    retry: () => { setError(null); access.retry() },
  }
}
