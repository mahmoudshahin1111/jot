import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { WorkspaceNavigationContext } from '@/hooks/use-workspace-shell'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import { createTaskSchema, createWorkspaceTask, deleteWorkspaceTask, getWorkspaceTasks, updateWorkspaceTask, updateWorkspaceTaskStatus, type Task, type TaskStatus } from '@/lib/tasks'

function sameTask(first: Task, second: Task) {
  return first.title === second.title && first.description === second.description && first.status === second.status
}

export function useWorkspaceTasks(workspaceId: string) {
  const { hasPermission } = useWorkspacePermissions()
  const canRead = hasPermission(PERMISSIONS.tasks.read)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [countRevision, setCountRevision] = useState(0)
  const [searchCountRevision, setSearchCountRevision] = useState(0)
  const creationInFlight = useRef(false)
  const navigation = useContext(WorkspaceNavigationContext)
  const [draft, setDraft] = useState<Task | null>(null)
  const draftRef = useRef<Task | null>(null)
  const savedRef = useRef<Task | null>(null)
  const savePromise = useRef<Promise<boolean> | null>(null)
  const [saving, setSaving] = useState(false)
  const [mutationId, setMutationId] = useState<string | null>(null)
  const mutationInFlight = useRef(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const canUpdate = hasPermission(PERMISSIONS.tasks.update)
  const canDelete = hasPermission(PERMISSIONS.tasks.delete)
  const savedTask = tasks?.find(task => task.id === draft?.id)
  const dirty = Boolean(draft && savedTask && !sameTask(draft, savedTask))
  const [pendingMove, setPendingMove] = useState<{ task: Task; status: TaskStatus } | null>(null)
  const pendingMoveRef = useRef(pendingMove)
  const movePromise = useRef<Promise<boolean> | null>(null)
  const [moving, setMoving] = useState(false)

  const flushMove = useCallback(async (): Promise<boolean> => {
    if (movePromise.current) return movePromise.current
    if (!pendingMoveRef.current) return true
    const operation = async () => {
      setMoving(true)
      try {
        while (pendingMoveRef.current) {
          if (!canUpdate) throw new Error('You do not have permission to update tasks.')
          const snapshot = pendingMoveRef.current
          const updated = await updateWorkspaceTaskStatus(workspaceId, snapshot.task.id, snapshot.status)
          setCountRevision(value => value + 1)
          setTasks(previous => previous?.map(task => task.id === updated.id ? updated : task) ?? null)
          if (draftRef.current?.id === updated.id) {
            savedRef.current = updated
            draftRef.current = updated
            setDraft(updated)
          }
          if (pendingMoveRef.current === snapshot) {
            pendingMoveRef.current = null
            setPendingMove(null)
          }
        }
        setNotice('Task status updated.')
        return true
      } catch (cause) {
        pendingMoveRef.current = null
        setPendingMove(null)
        setActionError(cause instanceof Error ? cause.message : 'Could not move the task. Please try again.')
        return false
      } finally {
        setMoving(false)
      }
    }
    const pending = operation()
    movePromise.current = pending
    try { return await pending } finally { movePromise.current = null }
  }, [canUpdate, workspaceId])

  useEffect(() => {
    if (!pendingMove) return
    const timeout = setTimeout(() => { void flushMove() }, 500)
    return () => clearTimeout(timeout)
  }, [pendingMove, flushMove])

  const save = useCallback(async (): Promise<boolean> => {
    if (savePromise.current) return savePromise.current
    const operation = async () => {
      setEditorError(null)
      setSaving(true)
      try {
        // Serialize writes and drain newer edits before closing or switching tasks.
        while (draftRef.current && savedRef.current && !sameTask(draftRef.current, savedRef.current)) {
          if (!canUpdate) throw new Error('You do not have permission to update tasks.')
          const snapshot = draftRef.current
          const validation = createTaskSchema.safeParse(snapshot)
          if (!validation.success) throw new Error(validation.error.issues[0].message)
          const updated = await updateWorkspaceTask(workspaceId, snapshot)
          if (updated.status !== savedRef.current.status) setCountRevision(value => value + 1)
          else setSearchCountRevision(value => value + 1)
          savedRef.current = updated
          setTasks(previous => previous?.map(task => task.id === updated.id ? updated : task) ?? null)
          if (draftRef.current === snapshot) {
            draftRef.current = updated
            setDraft(updated)
          }
        }
        setSaved(true)
        return true
      } catch (cause) {
        setEditorError(cause instanceof Error ? cause.message : 'Could not save the task. Please try again.')
        return false
      } finally {
        setSaving(false)
      }
    }
    const pending = operation()
    savePromise.current = pending
    try { return await pending } finally { savePromise.current = null }
  }, [canUpdate, workspaceId])

  useEffect(() => {
    if (!draft || !savedRef.current || sameTask(draft, savedRef.current) || !canUpdate || mutationId) return
    const timeout = setTimeout(() => { void save() }, 500)
    return () => clearTimeout(timeout)
  }, [draft, canUpdate, save, mutationId])

  useEffect(() => {
    const guard = () => {
      if (pendingMoveRef.current || movePromise.current) {
        void flushMove()
        return false
      }
      if (saving || mutationInFlight.current) return false
      if (!dirty) return true
      void save()
      return false
    }
    return navigation?.registerGuard(guard)
  }, [dirty, navigation, save, saving, flushMove, pendingMove, moving])

  useEffect(() => {
    if (!dirty && !saving && !pendingMove && !moving) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saving, pendingMove, moving])

  function changeDraft(changes: Partial<Pick<Task, 'title' | 'description' | 'status'>>) {
    if (!canUpdate || !draftRef.current || mutationInFlight.current || pendingMoveRef.current || movePromise.current) return
    const updated = { ...draftRef.current, ...changes }
    draftRef.current = updated
    setDraft(updated)
    setSaved(false)
    setEditorError(null)
  }

  async function select(task: Task | null) {
    if (mutationInFlight.current || task?.id === draftRef.current?.id) return
    if (!(await flushMove())) return
    if (draftRef.current && !(await save())) return
    draftRef.current = task
    savedRef.current = task
    setDraft(task)
    setSaved(false)
    setEditorError(null)
  }

  async function move(task: Task, status: TaskStatus) {
    if (!canUpdate || mutationInFlight.current || movePromise.current || task.status === status) return
    if (pendingMoveRef.current && pendingMoveRef.current.task.id !== task.id && !(await flushMove())) return
    if (!(await save())) return
    const pending = { task, status }
    pendingMoveRef.current = pending
    setPendingMove(pending)
    setActionError(null)
    setNotice('')
  }

  async function complete(task: Task) {
    if (!canUpdate || mutationInFlight.current) return
    mutationInFlight.current = true
    setMutationId(task.id)
    setActionError(null)
    try {
      if (!(await flushMove())) return
      if (!(await save())) return
      const current = savedRef.current?.id === task.id ? savedRef.current : task
      const updated = await updateWorkspaceTask(workspaceId, {
        ...current, status: current.status === 'done' ? 'todo' : 'done',
      })
      setCountRevision(value => value + 1)
      setTasks(previous => previous?.map(item => item.id === task.id ? updated : item) ?? null)
      if (draftRef.current?.id === task.id) {
        savedRef.current = updated
        draftRef.current = updated
        setDraft(updated)
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update task status. Please try again.')
    } finally {
      mutationInFlight.current = false
      setMutationId(null)
    }
  }

  async function remove() {
    const task = draftRef.current
    if (!task || !canDelete || mutationInFlight.current || !window.confirm(`Delete ${task.title}? This cannot be undone.`)) return
    mutationInFlight.current = true
    setMutationId(task.id)
    setEditorError(null)
    try {
      if (!(await flushMove())) return
      if (savePromise.current && !(await savePromise.current)) return
      await deleteWorkspaceTask(workspaceId, task.id)
      setCountRevision(value => value + 1)
      setTasks(previous => previous?.filter(item => item.id !== task.id) ?? null)
      draftRef.current = null
      savedRef.current = null
      setDraft(null)
      setNotice('Task deleted.')
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : 'Could not delete the task. Please try again.')
    } finally {
      mutationInFlight.current = false
      setMutationId(null)
    }
  }

  useEffect(() => {
    if (!canRead) return
    let active = true
    getWorkspaceTasks(workspaceId)
      .then(data => { if (active) { setTasks(data); setError(null) } })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load tasks. Please try again.')
      })
    return () => { active = false }
  }, [workspaceId, attempt, canRead])

  async function create(title: string) {
    if (creationInFlight.current) return false
    if (!canRead || !hasPermission(PERMISSIONS.tasks.create)) {
      setActionError('You do not have permission to create tasks.')
      return false
    }
    creationInFlight.current = true
    setCreating(true)
    setActionError(null)
    setNotice('')
    try {
      const task = await createWorkspaceTask(workspaceId, title)
      setCountRevision(value => value + 1)
      setTasks(previous => [...(previous ?? []), task])
      setNotice('Task added.')
      return true
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not add the task. Please try again.')
      return false
    } finally {
      creationInFlight.current = false
      setCreating(false)
    }
  }

  return {
    tasks: tasks?.map(task => pendingMove?.task.id === task.id ? { ...task, status: pendingMove.status } : task) ?? null,
    error, actionError, creating, notice, create, move, moving, movePending: pendingMove !== null,
    countRevision: countRevision + attempt, searchCountRevision: countRevision + searchCountRevision + attempt,
    draft, changeDraft, select, complete, remove, save, saving, dirty, saved, editorError, mutationId,
    retry: () => { setTasks(null); setError(null); setAttempt(value => value + 1) },
  }
}
