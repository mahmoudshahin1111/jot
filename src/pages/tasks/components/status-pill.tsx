import { taskStatusLabels, type TaskStatus } from '@/lib/tasks'

const pillStyles: Record<TaskStatus, string> = {
  todo: 'border-input',
  in_progress: 'border-blue-500 text-blue-500',
  done: 'border-green-500 text-green-500',
}

export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-block shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pillStyles[status]}`}>
      {taskStatusLabels[status]}
    </span>
  )
}
