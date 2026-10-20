import { useCallback, useEffect, useState } from 'react'
import { roleErrorMessage } from '@/lib/roles'

export function useRecordCount<T>(load: () => Promise<T>, enabled = true, revision = 0) {
  const [result, setResult] = useState<{
    load: () => Promise<T>
    revision: number
    attempt: number
    total: T | null
    error: string | null
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    if (!enabled) return
    let active = true
    void load().then(
      total => { if (active) setResult({ load, revision, attempt, total, error: null }) },
      cause => { if (active) setResult({ load, revision, attempt, total: null, error: roleErrorMessage(cause) }) },
    )
    return () => { active = false }
  }, [load, enabled, revision, attempt])

  const current = enabled && result?.load === load && result.revision === revision && result.attempt === attempt
  return { total: current ? result.total : null, error: current ? result.error : null, refresh }
}
