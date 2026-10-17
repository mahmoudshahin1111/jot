export function getAvatarColor(username: string) {
  const first = Array.from(username.trim())[0]?.toUpperCase() ?? ''
  if (/^[A-E]$/.test(first)) return 'bg-orange-600'
  if (/^[F-Z]$/.test(first)) return 'bg-green-700'
  return 'bg-slate-600'
}

export function getAvatarInitials(username: string) {
  return Array.from(username.trim()).slice(0, 2).join('').toUpperCase() || '?'
}
