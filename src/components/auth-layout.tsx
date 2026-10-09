import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import logo from '@/assets/icons/jot-64x64.png'

export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <main className="auth-page">
      <div className="mb-6 flex items-center justify-center gap-3">
        <img src={logo} width={40} height={40} alt="" />
        <span className="text-2xl font-semibold tracking-tight">Jot</span>
      </div>
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="gap-2 text-center">
          <h1 className="auth-title">{title}</h1>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  )
}
