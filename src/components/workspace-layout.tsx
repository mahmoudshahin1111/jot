import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { ArrowLeft, Home, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkspaceNavigationContext, useWorkspaceShell } from '@/hooks/use-workspace-shell'
import logo from '@/assets/icons/jot-64x64.png'

export function WorkspaceLayout() {
  const { workspaceId } = useParams()
  if (!workspaceId) return <p role="alert">Workspace ID is required.</p>
  return <WorkspaceShell key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceShell({ workspaceId }: { workspaceId: string }) {
  const shell = useWorkspaceShell(workspaceId)
  const basePath = `/workspaces/${workspaceId}`
  const navigation = [
    { to: basePath, label: 'Overview', icon: Home, end: true },
    { to: `${basePath}/settings/roles`, label: 'Roles and permissions', icon: Shield, end: false },
  ]

  if (shell.error) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
        <p role="alert" className="text-sm text-destructive">{shell.error}</p>
        <Button variant="outline" onClick={shell.retry}>Try again</Button>
        <Link to="/workspaces" className="text-sm underline">Back to workspaces</Link>
      </main>
    )
  }
  if (!shell.workspace) {
    return <main className="p-6"><p role="status">Loading workspace...</p></main>
  }

  return (
    <WorkspaceNavigationContext.Provider value={{ registerGuard: shell.registerGuard }}>
      <div className="min-h-svh md:flex">
        <aside className="border-b bg-card p-5 md:sticky md:top-0 md:h-svh md:w-60 md:shrink-0 md:border-r md:border-b-0">
          <div className="mb-6 flex items-center gap-3">
            <img src={logo} width={32} height={32} alt="" />
            <span className="text-xl font-semibold tracking-tight">Jot</span>
          </div>
          <p className="mb-5 truncate text-sm font-medium" title={shell.workspace.name}>{shell.workspace.name}</p>
          <nav aria-label="Workspace navigation" className="space-y-1">
            {navigation.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={event => { if (!shell.confirmNavigation()) event.preventDefault() }}
                className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${isActive ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
            <Link
              to="/workspaces"
              onClick={event => { if (!shell.confirmNavigation()) event.preventDefault() }}
              className="mt-5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> All workspaces
            </Link>
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </WorkspaceNavigationContext.Provider>
  )
}
