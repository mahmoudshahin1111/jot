import { useLocation } from 'react-router-dom'
import { Activity, LayoutDashboard, Shield, Users } from 'lucide-react'
import type { BreadcrumbItem } from '@/components/breadcrumb'

export function useWorkspaceNavigation(workspaceId: string) {
  const { pathname } = useLocation()
  const basePath = `/workspaces/${workspaceId}`
  const groups = [
    {
      label: 'Overview',
      items: [
        { to: `${basePath}/dashboard`, label: 'Dashboard', icon: LayoutDashboard },
        { to: `${basePath}/activity`, label: 'Activity', icon: Activity },
      ],
    },
    {
      label: 'Settings',
      items: [
        { to: `${basePath}/settings/roles`, label: 'Roles and permissions', icon: Shield },
        { to: `${basePath}/settings/users`, label: 'Users', icon: Users },
      ],
    },
  ]
  const currentGroup = groups.find(group => group.items.some(item => item.to === pathname))
  const currentPage = currentGroup?.items.find(item => item.to === pathname)
  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Workspace', to: `${basePath}/dashboard` },
    ...(currentGroup ? [{ label: currentGroup.label }] : []),
    ...(currentPage ? [{ label: currentPage.label }] : []),
  ]

  return { groups, breadcrumbs }
}
