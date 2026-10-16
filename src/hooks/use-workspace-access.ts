import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getWorkspaceAccess } from '@/lib/workspaces'
import { supabase } from '@/lib/supabaseClient'
import type { PermissionKey } from '@/lib/permissions'

type WorkspaceAccess = {
  workspace: Awaited<ReturnType<typeof getWorkspaceAccess>>
  checkAccess: () => Promise<boolean>
}

export const WorkspaceAccessContext = createContext<WorkspaceAccess | null>(null)

export function useWorkspaceAccess() {
  const access = useContext(WorkspaceAccessContext)
  if (!access) throw new Error('Workspace access requires a workspace access provider.')
  return access
}

export function useWorkspaceAccessState(workspaceId: string) {
  const [workspace, setWorkspace] = useState<Awaited<ReturnType<typeof getWorkspaceAccess>>>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'signed-out' | 'unavailable'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const activeRef = useRef(false)
  const requestRef = useRef(Symbol())

  const checkAccess = useCallback(async () => {
    const request = Symbol()
    requestRef.current = request
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw sessionError
    if (!activeRef.current || request !== requestRef.current) return false
    if (!data.session) {
      setWorkspace(null)
      setStatus('signed-out')
      return false
    }
    const result = await getWorkspaceAccess(workspaceId)
    if (!activeRef.current || request !== requestRef.current) return false
    setWorkspace(result)
    setStatus(result ? 'ready' : 'unavailable')
    setError(null)
    return result !== null
  }, [workspaceId])

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
        if (!active || !data.session) return
        await supabase.realtime.setAuth(data.session.access_token)
        if (!active) return
        subscribedUserId = data.session.user.id
        channel = supabase.channel(`workspace-access:${data.session.user.id}`, {
          config: { private: true },
        }).on('broadcast', { event: 'access_changed' }, ({ payload }) => {
          if (payload?.workspace_id === workspaceId) scheduleVerification()
        }).subscribe((connectionStatus, cause) => {
          if (!active) return
          if (connectionStatus === 'SUBSCRIBED') {
            setConnectionError(null)
            scheduleVerification()
          } else if (connectionStatus === 'CHANNEL_ERROR' || connectionStatus === 'TIMED_OUT' || connectionStatus === 'CLOSED') {
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
      if (event === 'SIGNED_OUT') {
        requestRef.current = Symbol()
        setWorkspace(null)
        setStatus('signed-out')
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (subscribedUserId && session?.user.id !== subscribedUserId) {
          requestRef.current = Symbol()
          setWorkspace(null)
          setStatus('loading')
          setAttempt(value => value + 1)
        } else scheduleVerification()
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
        void supabase.removeChannel(channel).then(result => {
          if (result !== 'ok') console.error('Unable to close workspace access connection:', result)
        }).catch(cause => console.error('Unable to close workspace access connection:', cause))
      }
    }
  }, [attempt, checkAccess, workspaceId])

  const hasPermission = useCallback((permission: PermissionKey) => workspace?.permissions.includes(permission) ?? false, [workspace])
  return {
    workspace, status, error: error ?? connectionError, hasPermission, checkAccess,
    retry: () => setAttempt(value => value + 1),
  }
}
