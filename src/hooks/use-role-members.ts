import { useCallback, useEffect, useRef, useState } from 'react'
import { getRoleMembers, removeRoleMember, rolePageSize, type RoleMember } from '@/lib/roles'
import { roleErrorMessage } from '@/hooks/use-workspace-roles'

export function useRoleMembers(
  workspaceId: string,
  roleId: string,
  updateCount: (roleId: string, count: number) => void,
  checkAccess: () => Promise<boolean>,
) {
  const [members, setMembers] = useState<RoleMember[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const fetching = useRef(false)
  const generation = useRef(0)
  const cursor = useRef<string | undefined>(undefined)
  const removalInFlight = useRef(false)

  const load = useCallback(async (append: boolean, current: number) => {
    if (fetching.current || removalInFlight.current) return
    fetching.current = true
    setLoading(true)
    setError(null)
    try {
      const page = await getRoleMembers(workspaceId, roleId, append ? cursor.current : undefined)
      if (current !== generation.current) return
      const batch = page.members.slice(0, rolePageSize)
      cursor.current = batch[batch.length - 1]?.user_id ?? cursor.current
      setMembers(previous => append ? [...previous, ...batch] : batch)
      setTotal(page.total)
      updateCount(roleId, page.total)
      setHasMore(page.members.length > rolePageSize)
    } catch (cause) {
      if (current === generation.current) setError(roleErrorMessage(cause))
    } finally {
      if (current === generation.current) {
        fetching.current = false
        setLoading(false)
      }
    }
  }, [roleId, updateCount, workspaceId])

  useEffect(() => {
    const current = ++generation.current
    const timeout = setTimeout(() => {
      fetching.current = false
      cursor.current = undefined
      setMembers([])
      setNotice('')
      void load(false, current)
    }, 0)
    return () => {
      clearTimeout(timeout)
      generation.current = current + 1
    }
  }, [load, revision])

  const loadMore = useCallback(() => {
    if (hasMore && !error) void load(true, generation.current)
  }, [error, hasMore, load])

  async function remove(member: RoleMember) {
    if (fetching.current || removalInFlight.current || !window.confirm(
      `Remove ${member.name} from this workspace? They will lose all access to this workspace.`,
    )) return
    removalInFlight.current = true
    setRemoving(member.user_id)
    setNotice('')
    setActionError(null)
    const current = generation.current
    try {
      await removeRoleMember(workspaceId, roleId, member.user_id)
      if (current !== generation.current) return
      setMembers(previous => previous.filter(item => item.user_id !== member.user_id))
      setTotal(total - 1)
      updateCount(roleId, total - 1)
      setNotice(`${member.name} removed from the workspace.`)
      await checkAccess()
    } catch (cause) {
      if (current === generation.current) setActionError(roleErrorMessage(cause))
    } finally {
      removalInFlight.current = false
      if (current === generation.current) setRemoving(null)
    }
  }

  return {
    members, total, hasMore, loading, error, actionError, removing, notice, loadMore, remove,
    retry: () => setRevision(value => value + 1),
  }
}
