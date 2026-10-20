export function getAvatarColor(username: string) {
  const first = Array.from(username.trim())[0]?.toUpperCase() ?? ''
  if (/^[A-E]$/.test(first)) return 'bg-orange-600'
  if (/^[F-Z]$/.test(first)) return 'bg-green-700'
  return 'bg-slate-600'
}

export function getAvatarInitials(username: string) {
  return Array.from(username.trim()).slice(0, 2).join('').toUpperCase() || '?'
}

export function getUserAvatarPath(value: unknown, userId: string) {
  if (typeof value !== 'string') return null
  const prefix = `avatars/${userId}/`
  if (!value.startsWith(prefix)) return null
  return /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(value.slice(prefix.length)) ? value : null
}
