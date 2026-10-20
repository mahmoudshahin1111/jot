import { z } from 'zod'

export const profileSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters.')
    .regex(/[A-Za-z]/, 'Password must include at least one letter.')
    .regex(/[0-9]/, 'Password must include at least one number.'),
  confirmPassword: z.string().min(1, 'Confirm your new password.'),
}).refine(values => values.password === values.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
})

export type ProfileValues = z.infer<typeof profileSchema>
