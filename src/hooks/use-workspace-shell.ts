import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getWorkspace, type Workspace } from '@/lib/workspaces'
import { supabase } from '@/lib/supabaseClient'

export const WorkspaceNavigationContext = createContext<{
  registerGuard: (guard: () => boolean) => () => void
} | null>(null)

export function useWorkspaceShell(workspaceId: string) {
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const guardRef = useRef<(() => boolean) | null>(null)

  const registerGuard = useCallback((guard: () => boolean) => {
    guardRef.current = guard
    return () => {
      if (guardRef.current === guard) guardRef.current = null
    }
  }, [])

  const confirmNavigation = useCallback(() => guardRef.current?.() ?? true, [])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) {
          if (active) navigate('/login', { replace: true })
          return
        }
        const result = await getWorkspace(workspaceId)
        if (!active) return
        if (!result) {
          navigate('/workspaces', { replace: true })
          return
        }
        setWorkspace(result)
        setError(null)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load this workspace.')
      }
    }
    void load()
    const interval = setInterval(() => { void load() }, 15000)
    window.addEventListener('focus', load)
    return () => {
      active = false
      clearInterval(interval)
      window.removeEventListener('focus', load)
    }
  }, [attempt, navigate, workspaceId])

  return { workspace, error, registerGuard, confirmNavigation, retry: () => setAttempt(value => value + 1) }
}
