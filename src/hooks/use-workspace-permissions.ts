import { useCallback } from 'react'
import { useWorkspaceAccess } from '@/hooks/use-workspace-access'
import type { PermissionKey } from '@/lib/permissions'

export function useWorkspacePermissions() {
  const { workspace } = useWorkspaceAccess()
  const hasPermission = useCallback(
    (permission: PermissionKey) => workspace?.permissions.includes(permission) ?? false,
    [workspace],
  )

  return { hasPermission }
}
