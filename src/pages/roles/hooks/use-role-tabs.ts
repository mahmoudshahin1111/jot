import { useState, type KeyboardEvent } from 'react'

export function useRoleTabs() {
  const [tab, setTab] = useState<'permissions' | 'members'>('permissions')
  function handleKeyDown(event: KeyboardEvent<HTMLElement>, value: 'permissions' | 'members') {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'permissions' : event.key === 'End' ? 'members' : value === 'members' ? 'permissions' : 'members'
    setTab(next)
    document.getElementById(`${next}-tab`)?.focus()
  }
  return { tab, setTab, handleKeyDown }
}
