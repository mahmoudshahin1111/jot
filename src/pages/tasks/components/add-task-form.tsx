import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createTaskSchema } from '@/lib/tasks'

export function AddTaskForm({ disabled, onCreate }: {
  disabled: boolean
  onCreate: (title: string) => Promise<boolean>
}) {
  const { register, handleSubmit, reset, setFocus, formState: { errors, isSubmitting } } = useForm<{ title: string }>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: { title: '' },
  })

  return (
    <form noValidate className="mt-6" onSubmit={handleSubmit(async ({ title }) => {
      if (disabled || isSubmitting) return
      if (await onCreate(title)) {
        reset()
        setFocus('title')
      }
    })}>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1 basis-56"
          aria-label="Task name"
          placeholder="Add a task and press Enter"
          readOnly={disabled || isSubmitting}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? 'task-name-error' : undefined}
          {...register('title')}
        />
        <Button type="submit" disabled={disabled || isSubmitting}>
          <Plus aria-hidden="true" /> {isSubmitting ? 'Adding...' : 'Add task'}
        </Button>
      </div>
      {errors.title && <p role="alert" id="task-name-error" className="mt-2 text-sm text-destructive">{errors.title.message}</p>}
    </form>
  )
}
