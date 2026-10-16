import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { AuthLayout } from '@/components/auth-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabaseClient'
import { acceptInvitation, getInvitation, inviteEmailSchema } from '@/lib/invitations'
import { roleErrorMessage } from '@/lib/roles'

export function AcceptInvitationPage() {
  const [params] = useSearchParams()
  const parsed = z.string().uuid().safeParse(params.get('id'))
  if (!parsed.success) return <AuthLayout title="Invalid invitation" description="This invitation link is incomplete."><p role="alert">Ask the sender for a new invitation.</p><Link to="/login" className="mt-4 block text-sm underline">Go to login</Link></AuthLayout>
  return <AcceptInvitation key={parsed.data} id={parsed.data} />
}

function AcceptInvitation({ id }: { id: string }) {
  const navigate = useNavigate()
  const [invitation, setInvitation] = useState<Awaited<ReturnType<typeof getInvitation>> | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const hashError = new URLSearchParams(window.location.hash.slice(1)).get('error_description')
        if (hashError) throw new Error(hashError)
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!active) return
        setSignedIn(Boolean(data.session))
        if (data.session) {
          const details = await getInvitation(id)
          if (active) setInvitation(details)
        }
      } catch (cause) {
        if (active) setError(roleErrorMessage(cause))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [id, attempt])

  async function sendLink() {
    if (inFlight.current) return
    const result = inviteEmailSchema.safeParse(email)
    if (!result.success) { setError(result.error.issues[0].message); return }
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: result.data,
        options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/invitations/accept?id=${id}` },
      })
      if (authError) throw authError
      setNotice('Check your inbox for a sign-in link, then review and accept this invitation.')
    } catch (cause) {
      setError(roleErrorMessage(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function accept() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const workspaceId = await acceptInvitation(id)
      navigate(`/workspaces/${workspaceId}`, { replace: true })
    } catch (cause) {
      setError(roleErrorMessage(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function switchAccount() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const { error: authError } = await supabase.auth.signOut()
      if (authError) throw authError
      setInvitation(null)
      setSignedIn(false)
    } catch (cause) {
      setError(roleErrorMessage(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Workspace invitation" description="Join another workspace without leaving your existing ones.">
      <div className="space-y-4">
        {loading ? <p role="status">Checking invitation...</p> : signedIn ? <>
          {invitation && <><p>You are invited to <strong>{invitation.workspace_name}</strong> as <strong>{invitation.role_name}</strong>.</p><p className="text-sm text-muted-foreground">Accepting grants this role to {invitation.email}. A role without permissions grants no workspace access.</p><Button disabled={busy} className="w-full" onClick={() => { void accept() }}>{busy ? 'Accepting...' : 'Accept invitation'}</Button></>}
          <Button variant="outline" disabled={busy} onClick={() => { void switchAccount() }}>Use a different account</Button>
        </> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void sendLink() }}>
          <p className="text-sm text-muted-foreground">Sign in with the invited email. If you are new to Jot, this also creates your account.</p>
          <Label htmlFor="accept-email">Invited email</Label>
          <Input id="accept-email" type="email" required autoComplete="email" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending...' : 'Email me a sign-in link'}</Button>
        </form>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {error && <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={busy || loading} onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>}
        <Link to="/workspaces" className="block text-sm underline">Back to workspaces</Link>
      </div>
    </AuthLayout>
  )
}
