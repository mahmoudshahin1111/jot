import { useContext, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle } from 'lucide-react'
import { Breadcrumb } from '@/components/breadcrumb'
import { UserMenu } from '@/components/user-menu'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthenticatedUser } from '@/hooks/use-authenticated-user'
import { WorkspaceAccessContext } from '@/hooks/use-workspace-access'
import { UserAvatar } from '@/components/user-avatar'
import { profileSchema, type ProfileValues } from '@/lib/profile-schema'
import { getRole } from '@/lib/roles'
import { getUserWorkspaces, getWorkspaceAccess } from '@/lib/workspaces'
import { supabase } from '@/lib/supabaseClient'

export function ProfilePage() {
  const { user, error: userError } = useAuthenticatedUser()
  const { workspaceId } = useParams()
  const workspaceAccess = useContext(WorkspaceAccessContext)
  const [standaloneWorkspace, setStandaloneWorkspace] = useState<Awaited<ReturnType<typeof getWorkspaceAccess>>>(null)
  const [loadedRole, setLoadedRole] = useState<{ workspaceId: string; name: string } | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [passwordsVisible, setPasswordsVisible] = useState(false)
  const [success, setSuccess] = useState(false)
  const [workspaceLookupComplete, setWorkspaceLookupComplete] = useState(Boolean(workspaceId))
  const { register, handleSubmit, setError, clearErrors, reset, formState: { errors, isSubmitting } } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { currentPassword: '', password: '', confirmPassword: '' },
  })

  useEffect(() => {
    if (workspaceId || !user) return
    let active = true
    async function findWorkspace() {
      try {
        const workspaces = await getUserWorkspaces()
        if (!active) return
        const workspace = workspaces[0]
        if (!workspace) return
        const access = await getWorkspaceAccess(workspace.id)
        if (!active) return
        if (!access) throw new Error('Unable to load your workspace access.')
        setStandaloneWorkspace(access)
      } catch (cause) {
        if (active) {
          setPageError(cause instanceof Error ? cause.message : 'Unable to load your workspace.')
        }
      } finally {
        if (active) setWorkspaceLookupComplete(true)
      }
    }
    void findWorkspace()
    return () => { active = false }
  }, [user, workspaceId])

  useEffect(() => {
    const workspace = workspaceAccess?.workspace ?? standaloneWorkspace
    if (!workspace) return
    let active = true
    getRole(workspace.id, workspace.role_id)
      .then(role => {
        if (active) setLoadedRole({
          workspaceId: workspace.id,
          name: role?.name ?? (workspace.is_owner ? 'Owner' : 'Member'),
        })
      })
      .catch(cause => {
        if (active) setPageError(cause instanceof Error ? cause.message : 'Unable to load your workspace role.')
      })
    return () => { active = false }
  }, [standaloneWorkspace, workspaceAccess?.workspace])

  async function onSubmit({ currentPassword, password }: ProfileValues) {
    clearErrors('root')
    if (!user?.email) {
      setError('root', { message: 'Unable to verify your current password because your account has no email address.' })
      return
    }
    try {
      const { error: verificationError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (verificationError) throw verificationError
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      reset()
      setPasswordsVisible(false)
      setSuccess(true)
    } catch (cause) {
      setError('root', {
        message: cause instanceof Error ? cause.message : 'Unable to update your password. Please try again.',
      })
    }
  }

  if (userError) return <main className="p-6"><p role="alert" className="text-sm text-destructive">{userError}</p></main>
  if (!user || !workspaceLookupComplete) return <main className="p-6"><p role="status">Loading your profile...</p></main>

  const metadata = user.user_metadata
  const username = [metadata.username, metadata.name, metadata.full_name, user.email?.split('@')[0]]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? 'User'
  const name = [metadata.full_name, metadata.name, username]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? username
  const standalone = !workspaceId
  const profileWorkspace = workspaceAccess?.workspace ?? standaloneWorkspace
  const profileRoleName = profileWorkspace?.is_owner
    ? loadedRole?.workspaceId === profileWorkspace.id ? loadedRole.name : 'Owner'
    : loadedRole?.workspaceId === profileWorkspace?.id ? loadedRole?.name ?? '' : ''

  return (
    <>
      {standalone ? (
        <header className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <Link to="/workspaces" className="text-sm underline">All workspaces</Link>
          <UserMenu />
        </header>
      ) : null}
      <div className="mx-auto max-w-7xl px-5 pt-5 sm:px-6">
        <Breadcrumb items={[{ label: 'account' }, { label: 'profile' }]} />
      </div>
      <main className="mx-auto max-w-xl space-y-6 px-5 pt-5 pb-16 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground">Your account details and password.</p>
        </header>
        {pageError && <p role="alert" className="text-sm text-destructive">{pageError}</p>}
        <Card className="flex-row flex-wrap items-center justify-between gap-4 rounded-lg border p-4 ring-0 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar text={username} className="size-11" decorative />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          {profileWorkspace && (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {profileRoleName ? `${profileRoleName} · ${profileWorkspace.name}` : profileWorkspace.name}
            </span>
          )}
        </Card>
        <Card className="gap-0 rounded-lg border p-4 ring-0 sm:p-5">
          <div className="mb-5">
            <h2 className="text-xl font-semibold tracking-tight">Change password</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              You'll stay signed in on this device. Other devices are signed out.
            </p>
          </div>
          <form
            noValidate
            onSubmit={event => { setSuccess(false); void handleSubmit(onSubmit)(event) }}
            className="space-y-4"
          >
            <fieldset disabled={isSubmitting} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type={passwordsVisible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  aria-invalid={Boolean(errors.currentPassword)}
                  aria-describedby={errors.currentPassword ? 'current-password-error' : undefined}
                  {...register('currentPassword')}
                />
                {errors.currentPassword && <p id="current-password-error" role="alert" className="text-xs text-destructive">{errors.currentPassword.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type={passwordsVisible ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-requirements password-error' : 'password-requirements'}
                  {...register('password')}
                />
                <ul id="password-requirements" className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>At least 8 characters</li>
                  <li>At least one letter</li>
                  <li>At least one number</li>
                </ul>
                {errors.password && <p id="password-error" role="alert" className="text-xs text-destructive">{errors.password.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type={passwordsVisible ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  aria-invalid={Boolean(errors.confirmPassword)}
                  aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
                  {...register('confirmPassword')}
                />
                {errors.confirmPassword && <p id="confirm-password-error" role="alert" className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
              </div>
              <label className="flex w-fit cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={passwordsVisible}
                  onChange={event => setPasswordsVisible(event.target.checked)}
                />
                Show passwords
              </label>
              {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                  {isSubmitting ? 'Updating...' : 'Update password'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    reset()
                    clearErrors()
                    setPasswordsVisible(false)
                    setSuccess(false)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </fieldset>
            {success && <p role="status" className="mt-4 text-sm text-success">Password updated successfully.</p>}
          </form>
        </Card>
      </main>
    </>
  )
}
