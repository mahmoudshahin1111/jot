import { z } from 'zod'

export const profileSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
}).refine(values => values.password === values.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
})

export type ProfileValues = z.infer<typeof profileSchema>
