import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'

export function useAuthenticatedUser() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let authChanged = false
    function updateUser(nextUser: User | null) {
      if (!active) return
      setUser(nextUser)
      if (!nextUser) navigate('/login', { replace: true })
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authChanged = true
      updateUser(session?.user ?? null)
    })
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authChanged) return
      if (sessionError) setError(sessionError.message)
      else updateUser(data.session?.user ?? null)
    }).catch(cause => {
      if (active && !authChanged) setError(cause instanceof Error ? cause.message : 'Unable to load your account.')
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [navigate])

  return { user, error }
}
