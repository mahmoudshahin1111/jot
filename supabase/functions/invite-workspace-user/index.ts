import { createClient } from 'npm:@supabase/supabase-js@2.117.2'

const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
const cors = {
  'Access-Control-Allow-Origin': new URL(appUrl).origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async request => {
  const respond = (status: number, body: object) => Response.json(body, { status, headers: cors })
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' })
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return respond(401, { error: 'Sign in to invite users' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: user, error: authError } = await caller.auth.getUser(authorization.slice(7))
  if (authError || !user.user) return respond(401, { error: 'Your session expired. Sign in again.' })
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return respond(400, { error: 'Invalid invitation request' })
  }
  if (typeof input !== 'object' || input === null || !('workspaceId' in input) || !('roleId' in input)
    || !('email' in input) || typeof input.workspaceId !== 'string' || !uuid.test(input.workspaceId)
    || typeof input.roleId !== 'string' || !uuid.test(input.roleId) || typeof input.email !== 'string') {
    return respond(400, { error: 'A workspace, role, and valid email are required' })
  }
  const email = input.email.trim().toLowerCase()
  const { data: id, error: invitationError } = await caller.rpc('create_workspace_invitation', {
    target_workspace_id: input.workspaceId, target_role_id: input.roleId, invited_email: email,
  })
  if (invitationError) return respond(invitationError.code === '42501' ? 403 : 400, { error: invitationError.message })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const mailer = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const redirect = new URL('/invitations/accept', appUrl)
    redirect.searchParams.set('id', id)
    // OTP supports existing accounts and new signups without exposing the auth user directory.
    const { error: emailError } = await mailer.auth.signInWithOtp({
      email, options: { shouldCreateUser: true, emailRedirectTo: redirect.toString() },
    })
    if (emailError) throw emailError
    const { data: delivered, error: deliveryError } = await admin.from('workspace_invitations')
      .update({ delivered_at: new Date().toISOString() }).eq('id', id).is('canceled_at', null).select('id').single()
    if (deliveryError || !delivered) throw new Error('The invitation was removed or delivery could not be recorded.')
    return respond(200, { id })
  } catch (cause) {
    const { error: cleanupError } = await admin.from('workspace_invitations')
      .update({ canceled_at: new Date().toISOString() }).eq('id', id).is('accepted_at', null)
    console.error('Workspace invitation delivery failed', { invitationId: id, cleanupFailed: Boolean(cleanupError) })
    const message = cause instanceof Error ? cause.message : 'Email delivery failed.'
    return respond(502, { error: `${message}${cleanupError ? ' Remove the pending invitation to free its slot.' : ' The invitation was canceled; please try again.'}` })
  }
})
