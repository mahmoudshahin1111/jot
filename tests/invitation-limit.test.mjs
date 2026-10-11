import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, admin, unwrap, anonymous } from './invitation-fixture.mjs'

test('10 pending invitations per sender globally, including concurrent requests; removal and expiry free slots', async () => {
  const f = await fixture()
  try {
    const sender = await f.user('sender')
    const other = await f.user('other')
    const a = await f.workspace(sender)
    const b = await f.workspace(sender)
    const c = await f.workspace(other)
    const viewer = await f.role('workspace.viewer')
    assert.equal((await anonymous().rpc('create_workspace_invitation', {
      target_workspace_id: a, target_role_id: viewer, invited_email: `${f.prefix}-anon@example.com`,
    })).error?.code, '42501')
    const results = await Promise.all(Array.from({ length: 11 }, (_, index) => sender.client.rpc('create_workspace_invitation', {
      target_workspace_id: index % 2 ? a : b, target_role_id: viewer, invited_email: `${f.prefix}-${index}@example.com`,
    })))
    assert.equal(results.filter(result => !result.error).length, 10)
    assert.equal(results.filter(result => result.error?.code === '23514').length, 1)
    const invitations = unwrap(await sender.client.rpc('list_my_workspace_invitations'))
    assert.equal(invitations.length, 10)
    assert.equal(new Set(invitations.map(invite => invite.workspace_id)).size, 2)
    await f.invite(other, c, viewer, `${f.prefix}-independent@example.com`)
    assert.equal(unwrap(await other.client.rpc('list_my_workspace_invitations')).length, 1)
    assert.equal((await other.client.rpc('cancel_workspace_invitation', { invitation_id: invitations[0].id })).error?.code, 'P0002')
    unwrap(await sender.client.rpc('cancel_workspace_invitation', { invitation_id: invitations[0].id }))
    assert.equal(unwrap(await sender.client.rpc('list_my_workspace_invitations')).length, 9)
    await f.invite(sender, a, viewer, `${f.prefix}-replacement@example.com`)
    assert.equal(unwrap(await sender.client.rpc('list_my_workspace_invitations')).length, 10)
    unwrap(await admin.from('workspace_invitations').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', invitations[1].id))
    await f.invite(sender, b, viewer, `${f.prefix}-after-expiry@example.com`)
    assert.equal(unwrap(await sender.client.rpc('list_my_workspace_invitations')).length, 10)
  } finally {
    await f.cleanup()
  }
})
