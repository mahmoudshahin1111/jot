import { getAvatarColor, getAvatarInitials, getUserAvatarPath } from '@/lib/avatar'
import { supabase } from '@/lib/supabaseClient'

export function UserAvatar({ text, imagePath, userId, className = 'size-10', decorative = false }: {
  text: string
  imagePath?: unknown
  userId?: string
  className?: string
  decorative?: boolean
}) {
  const savedPath = userId ? getUserAvatarPath(imagePath, userId) : null
  const imageUrl = savedPath ? supabase.storage.from('avatars').getPublicUrl(savedPath).data.publicUrl : null
  return (
    <span
      aria-hidden={decorative || undefined}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white ${getAvatarColor(text)} ${className}`}
    >
      {getAvatarInitials(text)}
      {imageUrl && <img src={imageUrl} alt="" className="absolute inset-0 size-full object-cover" />}
    </span>
  )
}
