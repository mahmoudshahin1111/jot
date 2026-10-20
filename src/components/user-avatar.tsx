import { getAvatarColor, getAvatarInitials } from '@/lib/avatar'

export function UserAvatar({ text, className = 'size-10', decorative = false }: {
  text: string
  className?: string
  decorative?: boolean
}) {
  return (
    <span
      aria-hidden={decorative || undefined}
      className={`flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${getAvatarColor(text)} ${className}`}
    >
      {getAvatarInitials(text)}
    </span>
  )
}
