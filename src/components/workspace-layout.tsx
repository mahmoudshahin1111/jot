import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkspaceNavigationContext, useWorkspaceShell } from '@/hooks/use-workspace-shell'
import logo from '@/assets/icons/jot-64x64.png'
import { Breadcrumb } from '@/components/breadcrumb'
import { useWorkspaceNavigation } from '@/hooks/use-workspace-navigation'

export function WorkspaceLayout() {
  const { workspaceId } = useParams()
  if (!workspaceId) return <p role="alert">Workspace ID is required.</p>
  return <WorkspaceShell key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceShell({ workspaceId }: { workspaceId: string }) {
  const shell = useWorkspaceShell(workspaceId)
  const { groups, breadcrumbs } = useWorkspaceNavigation(workspaceId)

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
    <WorkspaceNavigationContext.Provider value={{
      registerGuard: shell.registerGuard, checkAccess: shell.checkAccess, permissions: shell.permissions,
      roleId: shell.roleId, isOwner: shell.isOwner,
    }}>
      <div className="min-h-svh md:flex">
        <aside className="flex flex-col border-b bg-card px-3 py-5 md:sticky md:top-0 md:h-svh md:w-52 md:shrink-0 md:border-r md:border-b-0">
          <div className="mb-8 flex items-center gap-2 px-2">
            <img src={logo} width={24} height={24} alt="" />
            <span className="shrink-0 text-sm font-semibold tracking-tight">Jot</span>
            <span className="text-muted-foreground" aria-hidden="true">/</span>
            <span className="truncate text-xs font-medium" title={shell.workspace.name}>{shell.workspace.name}</span>
          </div>
          <nav aria-label="Workspace navigation" className="space-y-6">
            {groups.map(group => (
              <section key={group.label} aria-label={group.label}>
                <h2 className="mb-2 px-2 text-[11px] font-medium text-muted-foreground">{group.label}</h2>
                <ul className="space-y-1">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <NavLink
                        to={to}
                        end
                        onClick={event => { if (!shell.confirmNavigation()) event.preventDefault() }}
                        className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-2 py-2 text-xs transition-colors ${isActive ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                      >
                        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                        {label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          <div className="mt-8 md:mt-auto">
            <Link
              to="/workspaces"
              onClick={event => { if (!shell.confirmNavigation()) event.preventDefault() }}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" /> All workspaces
            </Link>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-6">
            <Breadcrumb items={breadcrumbs} onNavigate={shell.confirmNavigation} />
          </div>
          <Outlet />
        </div>
      </div>
    </WorkspaceNavigationContext.Provider>
  )
}
