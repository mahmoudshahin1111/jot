import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle } from 'lucide-react'
import { UserMenu } from '@/components/user-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthenticatedUser } from '@/hooks/use-authenticated-user'
import { profileSchema, type ProfileValues } from '@/lib/profile-schema'
import { supabase } from '@/lib/supabaseClient'

export function ProfilePage() {
  const { user, error } = useAuthenticatedUser()
  const [success, setSuccess] = useState(false)
  const { register, handleSubmit, setError, clearErrors, reset, formState: { errors, isSubmitting } } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit({ password }: ProfileValues) {
    clearErrors('root')
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      reset()
      setSuccess(true)
    } catch (cause) {
      setError('root', { message: cause instanceof Error ? cause.message : 'Unable to update your password. Please try again.' })
    }
  }

  if (error) return <main className="p-6"><p role="alert" className="text-destructive">{error}</p></main>
  if (!user) return <main className="p-6"><p role="status">Loading your profile...</p></main>

  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6">
        <Link to="/workspaces" className="text-sm underline">All workspaces</Link>
        <UserMenu />
      </header>
      <main className="mx-auto max-w-md space-y-6 px-5 py-8">
        <div>
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">Change your password. Use at least 6 characters.</p>
        </div>
        <form noValidate onSubmit={event => { setSuccess(false); void handleSubmit(onSubmit)(event) }} className="space-y-5">
          <fieldset disabled={isSubmitting} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input id="password" type="password" autoComplete="new-password" required
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
              />
              {errors.password && <p id="password-error" role="alert" className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" required
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && <p id="confirm-password-error" role="alert" className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
            </div>
            {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {isSubmitting ? 'Saving...' : 'Save password'}
            </Button>
          </fieldset>
          {success && <p role="status" className="text-sm">Password updated successfully.</p>}
        </form>
      </main>
    </>
  )
}
