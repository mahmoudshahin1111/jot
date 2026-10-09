import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle } from 'lucide-react'
import { AuthLayout } from '@/components/auth-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { loginSchema, type LoginValues } from '@/lib/login-schema'
import { supabase } from '@/lib/supabaseClient'

export function LoginPage() {
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit({ email, password }: LoginValues) {
    clearErrors('root')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError('root', { message: error.message })
        return
      }
      if (!data.user || !data.session) {
        setError('root', { message: 'Login could not be completed. Please try again.' })
        return
      }
      reset()
      navigate('/workspaces', { replace: true })
    } catch (error) {
      setError('root', {
        message: error instanceof Error
          ? error.message
          : 'Unable to connect to login. Please try again.',
      })
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to your Jot account."
    >
          <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <fieldset disabled={isSubmitting} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'login-email-error' : undefined}
                  {...register('email')}
                />
                {errors.email && <p id="login-email-error" className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'login-password-error' : undefined}
                  {...register('password')}
                />
                {errors.password && <p id="login-password-error" className="text-sm text-destructive">{errors.password.message}</p>}
              </div>
              {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </fieldset>
          </form>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            New to Jot? <Link to="/signup" className="font-medium text-primary underline underline-offset-4">Create an account</Link>
          </p>
    </AuthLayout>
  )
}
