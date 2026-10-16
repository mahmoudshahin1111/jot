import { useLocation } from 'react-router-dom'
import { Activity, LayoutDashboard, ListChecks, Shield, Users, type LucideIcon } from 'lucide-react'
import type { BreadcrumbItem } from '@/components/breadcrumb'
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions'

export function useWorkspaceNavigation(workspaceId: string, hasPermission: (permission: PermissionKey) => boolean) {
  const { pathname } = useLocation()
  const basePath = `/workspaces/${workspaceId}`
  const navigation: { label: string; items: { to: string; label: string; icon: LucideIcon; permission?: PermissionKey }[] }[] = [
    {
      label: 'Overview',
      items: [
        { to: `${basePath}/dashboard`, label: 'Dashboard', icon: LayoutDashboard },
        { to: `${basePath}/tasks`, label: 'Tasks', icon: ListChecks, permission: PERMISSIONS.tasks.read },
        { to: `${basePath}/activity`, label: 'Activity', icon: Activity },
      ],
    },
    {
      label: 'Settings',
      items: [
        { to: `${basePath}/settings/roles`, label: 'Roles and permissions', icon: Shield, permission: PERMISSIONS.roles.read },
        { to: `${basePath}/settings/users`, label: 'Users', icon: Users, permission: PERMISSIONS.roles.read },
      ],
    },
  ]
  const groups = navigation.map(group => ({
    ...group,
    items: group.items.filter(item => !item.permission || hasPermission(item.permission)),
  })).filter(group => group.items.length > 0)
  const currentGroup = groups.find(group => group.items.some(item => item.to === pathname))
  const currentPage = currentGroup?.items.find(item => item.to === pathname)
  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Workspace', to: `${basePath}/dashboard` },
    ...(currentGroup ? [{ label: currentGroup.label }] : []),
    ...(currentPage ? [{ label: currentPage.label }] : []),
  ]

  return { groups, breadcrumbs }
}
