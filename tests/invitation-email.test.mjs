import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, admin, unwrap, anonymous } from './invitation-fixture.mjs'

test('local Supabase emails invite existing and new accounts, with acceptance required', async () => {
  const f = await fixture()
  try {
    const sender = await f.user('sender')
    const existing = await f.user('existing')
    const workspace = await f.workspace(sender)
    const viewer = await f.role('workspace.viewer')
    assert.ok((await anonymous().functions.invoke('invite-workspace-user', { body: {} })).error)
    for (const email of [existing.email, `${f.prefix}-new@example.com`]) {
      const invitation = unwrap(await sender.client.functions.invoke('invite-workspace-user', {
        body: { workspaceId: workspace, roleId: viewer, email },
      }))
      assert.equal(typeof invitation.id, 'string')
      let message
      for (let attempt = 0; attempt < 20; attempt++) {
        const inbox = await (await fetch('http://127.0.0.1:54324/api/v1/messages')).json()
        message = inbox.messages.find(item => item.To.some(recipient => recipient.Address === email))
        if (message) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.ok(message, 'Invitation email must reach the local inbox')
      const details = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${message.ID}`)).json()
      const link = details.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')
      assert.ok(link, 'Email must contain the Supabase confirmation link')
      const url = new URL(link)
      assert.equal(url.origin, 'http://127.0.0.1:54321')
      assert.equal(new URL(url.searchParams.get('redirect_to')).pathname, '/invitations/accept')
      assert.equal(new URL(url.searchParams.get('redirect_to')).searchParams.get('id'), invitation.id)
      const verified = await fetch(link, { redirect: 'manual' })
      assert.equal(verified.status, 303)
      const redirect = new URL(verified.headers.get('location'))
      const hash = new URLSearchParams(redirect.hash.slice(1))
      assert.equal(hash.has('error'), false, hash.get('error_description'))
      const recipient = anonymous()
      const { session } = unwrap(await recipient.auth.setSession({
        access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'),
      }))
      if (email !== existing.email) f.trackUser(session.user.id)
      assert.equal(session.user.email, email)
      assert.equal(unwrap(await admin.from('workspace_users').select('*').eq('workspace_id', workspace).eq('user_id', session.user.id)).length, 0, 'Email verification alone must not grant membership')
      assert.equal(unwrap(await recipient.rpc('accept_workspace_invitation', { invitation_id: invitation.id })), workspace)
      assert.equal(unwrap(await recipient.from('workspace_users').select('*').eq('workspace_id', workspace).eq('user_id', session.user.id)).length, 1)
    }
    assert.equal(unwrap(await sender.client.rpc('list_my_workspace_invitations')).length, 0)
    const failed = await sender.client.functions.invoke('invite-workspace-user', {
      body: { workspaceId: workspace, roleId: viewer, email: `invalid<${f.prefix}>@example.com` },
    })
    assert.ok(failed.error, 'Supabase must reject an invalid email instead of reporting delivery success')
    assert.equal(unwrap(await sender.client.rpc('list_my_workspace_invitations')).length, 0, 'Failed email delivery must free the reserved invitation slot')
  } finally {
    await f.cleanup()
  }
})
