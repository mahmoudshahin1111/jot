import { useContext, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog } from '@base-ui/react/dialog'
import { Camera, CheckCircle2, LoaderCircle } from 'lucide-react'
import { Breadcrumb } from '@/components/breadcrumb'
import { UserMenu } from '@/components/user-menu'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthenticatedUser } from '@/hooks/use-authenticated-user'
import { WorkspaceAccessContext } from '@/hooks/use-workspace-access'
import { UserAvatar } from '@/components/user-avatar'
import { getUserAvatarPath } from '@/lib/avatar'
import { profileSchema, type ProfileValues } from '@/lib/profile-schema'
import { getRole } from '@/lib/roles'
import { getUserWorkspaces, getWorkspaceAccess } from '@/lib/workspaces'
import { supabase } from '@/lib/supabaseClient'

const avatarMaxBytes = 2 * 1024 * 1024
const avatarMaxDimension = 1024

type AvatarUploadState = 'idle' | 'uploading' | 'saving' | 'success' | 'error'

export function ProfilePage() {
  const { user, error: userError } = useAuthenticatedUser()
  const { workspaceId } = useParams()
  const workspaceAccess = useContext(WorkspaceAccessContext)
  const [standaloneWorkspace, setStandaloneWorkspace] = useState<Awaited<ReturnType<typeof getWorkspaceAccess>>>(null)
  const [loadedRole, setLoadedRole] = useState<{ workspaceId: string; name: string } | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [passwordsVisible, setPasswordsVisible] = useState(false)
  const [success, setSuccess] = useState(false)
  const [avatarPath, setAvatarPath] = useState<string | null>(null)
  const [avatarValidationError, setAvatarValidationError] = useState<string | null>(null)
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false)
  const [avatarUploadState, setAvatarUploadState] = useState<AvatarUploadState>('idle')
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0)
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null)
  const [avatarSuccessMessage, setAvatarSuccessMessage] = useState('Profile photo saved successfully.')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const avatarFileInput = useRef<HTMLInputElement>(null)
  const avatarRequest = useRef<AbortController | null>(null)
  const avatarXhr = useRef<XMLHttpRequest | null>(null)
  useEffect(() => () => {
    avatarRequest.current?.abort()
    avatarXhr.current?.abort()
  }, [])
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

  async function validateAvatarFile(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Choose a JPEG, PNG, or WebP image.')
    }
    if (file.size === 0 || file.size > avatarMaxBytes) {
      throw new Error('Choose an image that is no larger than 2 MB.')
    }
    let image: ImageBitmap
    try {
      image = await createImageBitmap(file)
    } catch {
      throw new Error('Choose a valid JPEG, PNG, or WebP image.')
    }
    const { width, height } = image
    image.close()
    if (width > avatarMaxDimension || height > avatarMaxDimension) {
      throw new Error('Choose an image no larger than 1024 × 1024 pixels.')
    }
  }

  function uploadToSignedUrl(signedUrl: string, file: File) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      avatarXhr.current = xhr
      const clearRequest = () => {
        if (avatarXhr.current === xhr) avatarXhr.current = null
      }
      xhr.open('PUT', new URL(signedUrl, import.meta.env.VITE_SUPABASE_URL).toString())
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) setAvatarUploadProgress(Math.round((event.loaded / event.total) * 100))
      }
      xhr.onload = () => {
        clearRequest()
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`Image upload failed (${xhr.status}). Please retry.`))
      }
      xhr.onerror = () => {
        clearRequest()
        reject(new Error('Image upload failed because of a network error. Please retry.'))
      }
      xhr.onabort = () => {
        clearRequest()
        reject(new DOMException('Image upload cancelled.', 'AbortError'))
      }
      xhr.send(file)
    })
  }

  async function uploadAvatar(file: File) {
    const controller = new AbortController()
    avatarRequest.current = controller
    setAvatarUploadState('uploading')
    setAvatarUploadProgress(0)
    setAvatarUploadError(null)
    setAvatarSuccessMessage('Profile photo saved successfully.')
    try {
      const { data: signed, error: signError } = await supabase.functions.invoke<{
        signedUrl: string
        path: string
      }>('profile-avatar', {
        body: { action: 'create', contentType: file.type, size: file.size },
        signal: controller.signal,
      })
      if (signError) throw signError
      if (controller.signal.aborted) return
      if (!signed?.signedUrl || !signed.path) throw new Error('The server returned an invalid upload link.')
      await uploadToSignedUrl(signed.signedUrl, file)
      setAvatarUploadState('saving')
      const { data: saved, error: saveError } = await supabase.functions.invoke<{ path: string }>('profile-avatar', {
        body: { action: 'complete', path: signed.path },
      })
      if (saveError) throw saveError
      if (saved?.path !== signed.path) throw new Error('The server did not confirm the uploaded image.')
      setAvatarPath(saved.path)
      window.dispatchEvent(new CustomEvent('jot:avatar-updated', { detail: saved.path }))
      let refreshFailed = false
      try {
        const { error } = await supabase.auth.refreshSession()
        refreshFailed = Boolean(error)
      } catch {
        refreshFailed = true
      }
      if (refreshFailed) {
        setAvatarSuccessMessage('Profile photo saved. Reload the page if other avatar locations do not update.')
      }
      setAvatarUploadState('success')
      setAvatarUploadProgress(100)
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return
      setAvatarUploadState('error')
      setAvatarUploadError(cause instanceof Error ? cause.message : 'Unable to upload your image. Please retry.')
    } finally {
      if (avatarRequest.current === controller) avatarRequest.current = null
    }
  }

  function cancelAvatarUpload() {
    avatarRequest.current?.abort()
    avatarXhr.current?.abort()
    setAvatarDialogOpen(false)
    setAvatarUploadState('idle')
    setAvatarUploadProgress(0)
    setAvatarUploadError(null)
  }

  async function chooseAvatar(file: File | undefined) {
    setAvatarValidationError(null)
    if (!file) return
    try {
      await validateAvatarFile(file)
    } catch (cause) {
      setAvatarValidationError(cause instanceof Error ? cause.message : 'Choose a valid image.')
      return
    }
    setAvatarFile(file)
    setAvatarDialogOpen(true)
    void uploadAvatar(file)
  }

  if (userError) return <main className="p-6"><p role="alert" className="text-sm text-destructive">{userError}</p></main>
  if (!user || !workspaceLookupComplete) return <main className="p-6"><p role="status">Loading your profile...</p></main>

  const metadata = user.user_metadata
  const savedAvatarPath = getUserAvatarPath(metadata.avatar_path, user.id)
  const profileAvatarPath = avatarPath ?? savedAvatarPath
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
            <div className="flex flex-col items-center gap-1.5">
              <input
                ref={avatarFileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Choose a profile image"
                onChange={event => {
                  void chooseAvatar(event.target.files?.[0])
                  event.currentTarget.value = ''
                }}
              />
              <button
                type="button"
                title="Change profile photo"
                aria-label="Change profile photo"
                onClick={() => avatarFileInput.current?.click()}
                className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <UserAvatar text={username} imagePath={profileAvatarPath} userId={user.id} className="size-11" decorative />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  <Camera className="size-4" />
                </span>
              </button>
              <span className="text-[10px] text-muted-foreground">Change photo</span>
              {avatarValidationError && <p role="alert" className="max-w-40 text-center text-xs text-destructive">{avatarValidationError}</p>}
            </div>
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
      <Dialog.Root open={avatarDialogOpen} onOpenChange={open => {
        if (open) {
          setAvatarDialogOpen(true)
        } else if (avatarUploadState !== 'saving') {
          if (avatarUploadState === 'uploading') cancelAvatarUpload()
          else setAvatarDialogOpen(false)
        }
      }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
            <Dialog.Title className="text-xl font-semibold">Upload profile photo</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              JPEG, PNG, or WebP up to 2 MB and 1024 × 1024 pixels.
            </Dialog.Description>
            <div aria-live="polite" className="mt-5 space-y-4">
              {avatarUploadState === 'uploading' && (
                <>
                  <p className="flex items-center gap-2 text-sm">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Uploading image… {avatarUploadProgress}%
                  </p>
                  <div
                    role="progressbar"
                    aria-label="Image upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={avatarUploadProgress}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${avatarUploadProgress}%` }} />
                  </div>
                </>
              )}
              {avatarUploadState === 'saving' && (
                <p className="flex items-center gap-2 text-sm">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Saving your profile photo…
                </p>
              )}
              {avatarUploadState === 'success' && (
                <p role="status" className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  {avatarSuccessMessage}
                </p>
              )}
              {avatarUploadState === 'error' && avatarUploadError && (
                <p role="alert" className="text-sm text-destructive">{avatarUploadError}</p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              {avatarUploadState === 'uploading' || avatarUploadState === 'saving' ? (
                <Button type="button" variant="outline" disabled={avatarUploadState === 'saving'} onClick={cancelAvatarUpload}>
                  Cancel
                </Button>
              ) : avatarUploadState === 'success' ? (
                <Button type="button" onClick={() => setAvatarDialogOpen(false)}>Close</Button>
              ) : avatarUploadState === 'error' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setAvatarDialogOpen(false)}>Close</Button>
                  <Button type="button" onClick={() => avatarFile && void uploadAvatar(avatarFile)}>Retry</Button>
                </>
              ) : null}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
