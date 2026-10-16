import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle } from 'lucide-react'
import { AuthLayout } from '@/components/auth-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabaseClient'
import { createWorkspace, createWorkspaceSchema, getUserWorkspaces, type Workspace } from '@/lib/workspaces'

export function WorkspacesPage({ create = false }: { create?: boolean }) {
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { register, handleSubmit, setError, clearErrors, reset, formState: { errors, isSubmitting } } = useForm<{ name: string }>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: '' },
  })

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!sessionData.session) {
          if (active) navigate('/login', { replace: true })
          return
        }
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        if (!data.user) {
          if (active) navigate('/login', { replace: true })
          return
        }
        const memberships = await getUserWorkspaces()
        if (!active) return
        if (!create && memberships.length === 0) {
          navigate('/workspaces/new', { replace: true })
          return
        }
        setWorkspaces(memberships)
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : 'Unable to load your workspaces.')
      }
    }
    void load()
    return () => { active = false }
  }, [attempt, create, navigate])

  async function onSubmit({ name }: { name: string }) {
    clearErrors('root')
    try {
      await createWorkspace(name)
      reset()
      navigate('/workspaces', { replace: true })
    } catch (error) {
      setError('root', { message: error instanceof Error ? error.message : 'Unable to create your workspace.' })
    }
  }

  return (
    <AuthLayout
      title={create ? 'Create your workspace' : 'Your workspaces'}
      description={create ? 'Give your team and tasks a place to belong.' : 'Workspaces you belong to.'}
    >
      {loadError ? (
        <div className="space-y-4">
          <p role="alert" className="text-sm text-destructive">{loadError}</p>
          <Button onClick={() => {
            setLoadError(null)
            setWorkspaces(null)
            setAttempt(value => value + 1)
          }}>Try again</Button>
          <Link to="/login" className="ml-4 text-sm underline">Go to login</Link>
        </div>
      ) : workspaces === null ? (
        <p role="status" className="flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Checking your workspaces...
        </p>
      ) : create ? (
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <fieldset disabled={isSubmitting} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                placeholder="My workspace"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'workspace-name-error' : undefined}
                {...register('name')}
              />
              {errors.name && <p id="workspace-name-error" className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {isSubmitting ? 'Creating workspace...' : 'Create workspace'}
            </Button>
          </fieldset>
          {workspaces.length > 0 && <Link to="/workspaces" className="block text-center text-sm underline">Back to workspaces</Link>}
        </form>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-2">
            {workspaces.map(workspace => (
              <li key={workspace.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <Link to={`/workspaces/${workspace.id}`} className="flex w-full items-center justify-between gap-3 text-sm font-medium hover:text-primary-text">
                  <span>{workspace.name}</span>
                  <span className="shrink-0 text-primary-text">Open workspace</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/workspaces/new" className="text-sm font-medium underline">Create another workspace</Link>
          <p className="text-sm text-muted-foreground">Task management is coming next.</p>
        </div>
      )}
    </AuthLayout>
  )
}
