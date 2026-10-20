import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Menu } from '@base-ui/react/menu'
import { LogOut, UserRound } from 'lucide-react'
import { UserAvatar } from '@/components/user-avatar'
import { useAuthenticatedUser } from '@/hooks/use-authenticated-user'
import { supabase } from '@/lib/supabaseClient'

export function UserMenu({
  onNavigate,
  onLogout,
  loggingOut = false,
}: {
  onNavigate?: () => boolean
  onLogout?: () => Promise<void>
  loggingOut?: boolean
}) {
  const { user, error } = useAuthenticatedUser()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function logout() {
    if (onLogout) return onLogout()
    if (inFlight.current) return
    inFlight.current = true
    setSigningOut(true)
    setLogoutError(null)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      navigate('/login', { replace: true })
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : 'Unable to log out. Please try again.')
    } finally {
      inFlight.current = false
      setSigningOut(false)
    }
  }

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!user) return null
  const metadata = user.user_metadata
  const username = [metadata.username, metadata.name, metadata.full_name, user.email?.split('@')[0]]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? 'User'
  const name = [metadata.full_name, metadata.name, username]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? username
  const avatar = <UserAvatar text={username} />
  const workspaceId = pathname.match(/^\/workspaces\/([^/]+)/)?.[1]
  const profilePath = workspaceId ? `/workspaces/${workspaceId}/profile` : '/profile'
  const itemClass = 'flex min-h-11 items-center gap-2 rounded-md px-3 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50'

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <Menu.Root>
        <Menu.Trigger
          aria-label="User menu"
          disabled={loggingOut || signingOut}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {avatar}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" collisionPadding={8} className="z-50">
            <Menu.Popup className="max-h-[var(--available-height)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md outline-none">
              <div className="flex items-center gap-3 p-3">
                {avatar}
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">{name}</p>
                  <p className="break-words text-xs text-muted-foreground">{username}</p>
                </div>
              </div>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item
                render={<Link to={profilePath} />}
                onClick={event => { if (onNavigate && !onNavigate()) event.preventDefault() }}
                className={itemClass}
              >
                <UserRound className="size-4" aria-hidden="true" /> Profile
              </Menu.Item>
              <Menu.Item onClick={() => { void logout() }} className={itemClass}>
                <LogOut className="size-4" aria-hidden="true" /> Log out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {logoutError && <p role="alert" className="max-w-64 text-sm text-destructive">{logoutError}</p>}
    </div>
  )
}
