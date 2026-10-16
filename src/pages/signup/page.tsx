import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/components/auth-layout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signupSchema, type SignupValues } from '@/lib/signup-schema'
import { supabase } from '@/lib/supabaseClient'

export function SignupPage() {
  const navigate = useNavigate()
  const [success, setSuccess] = useState<'confirmation' | 'signed-in' | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  })

  async function onSubmit({ email, password }: SignupValues) {
    clearErrors('root')
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { emailRedirectTo: `${window.location.origin}/workspaces` },
      })
      if (error) {
        setError('root', { message: error.message })
        return
      }
      if (!data.user) {
        setError('root', { message: 'Signup could not be completed. Please try again.' })
        return
      }
      reset()
      if (data.session) {
        navigate('/workspaces', { replace: true })
      } else {
        setSuccess('confirmation')
      }
    } catch (error) {
      setError('root', {
        message: error instanceof Error
          ? error.message
          : 'Unable to connect to signup. Please try again.',
      })
    }
  }

  return (
    <AuthLayout
      title={success ? 'You are nearly there' : 'Create your account'}
      description={success ? 'Your next step starts here.' : 'A clearer space for your tasks and your team.'}
    >
          {success ? (
            <div role="status" className="space-y-4 py-4 text-center">
              <MailCheck className="mx-auto size-10 text-primary" aria-hidden="true" />
              <p>
                {success === 'confirmation'
                  ? 'Check your inbox for a confirmation link to continue. If you already have an account, use your existing sign-in details.'
                  : 'Your account is ready and you are signed in.'}
              </p>
              <p className="text-muted-foreground">
                After signing in, you will be asked to create a workspace if you do not belong to one yet.
              </p>
            </div>
          ) : (
            <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <fieldset disabled={isSubmitting} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? 'email-error' : undefined}
                    {...register('email')}
                  />
                  {errors.email && <p id="email-error" className="text-sm text-destructive">{errors.email.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? 'password-hint password-error' : 'password-hint'}
                    {...register('password')}
                  />
                  <p id="password-hint" className="text-sm text-muted-foreground">Use at least 6 characters.</p>
                  {errors.password && <p id="password-error" className="text-sm text-destructive">{errors.password.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(errors.confirmPassword)}
                    aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
                    {...register('confirmPassword')}
                  />
                  {errors.confirmPassword && <p id="confirm-password-error" className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
                </div>
                {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                  {isSubmitting ? 'Creating account...' : 'Create account'}
                </Button>
              </fieldset>
            </form>
          )}
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already have an account? <Link to="/login" className="font-medium text-primary-text underline underline-offset-4">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
