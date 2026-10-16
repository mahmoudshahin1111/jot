import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createRoleSchema } from '@/lib/roles'

export function CreateRoleDialog({ open, onOpenChange, busy, error, onCreate }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  error: string | null
  onCreate: (name: string) => Promise<boolean>
}) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<{ name: string }>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '' },
  })
  const saving = busy || isSubmitting

  return (
    <Dialog.Root open={open} onOpenChange={value => {
      if (saving) return
      reset()
      onOpenChange(value)
    }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <Dialog.Title className="text-xl font-semibold">Create role</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            Give the role a name. You can configure permissions and manage members after creating it.
          </Dialog.Description>
          <form noValidate className="mt-5 space-y-5" onSubmit={handleSubmit(async ({ name }) => {
            if (saving) return
            if (await onCreate(name)) {
              reset()
              onOpenChange(false)
            }
          })}>
            <fieldset disabled={saving} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="role-name">Role name</Label>
                <Input
                  id="role-name"
                  placeholder="e.g. Project manager"
                  autoFocus
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'role-name-error' : undefined}
                  {...register('name')}
                />
                {errors.name && <p role="alert" id="role-name-error" className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => {
                  reset()
                  onOpenChange(false)
                }}>Cancel</Button>
                <Button type="submit">{saving ? 'Creating...' : 'Create role'}</Button>
              </div>
            </fieldset>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
