import { useState, type DragEvent } from 'react'
import type { Task, TaskStatus } from '@/lib/tasks'

export function useTaskDrag(tasks: Task[], enabled: boolean, onMove: (task: Task, status: TaskStatus) => void) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropStatus, setDropStatus] = useState<TaskStatus | null>(null)

  function reset() {
    setDraggedId(null)
    setDropStatus(null)
  }

  function taskDragProps(task: Task) {
    return {
      draggable: enabled,
      onDragStart(event: DragEvent<HTMLElement>) {
        if (!enabled) { event.preventDefault(); return }
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        setDraggedId(task.id)
      },
      onDragEnd: reset,
    }
  }

  function groupDropProps(status: TaskStatus) {
    return {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!enabled || !draggedId) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropStatus(status)
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropStatus(null)
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!enabled || !draggedId) return
        event.preventDefault()
        const task = tasks.find(item => item.id === draggedId)
        reset()
        if (task) onMove(task, status)
      },
    }
  }

  return { taskDragProps, groupDropProps, dropStatus }
}
