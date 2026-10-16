import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, admin, unwrap, anonymous } from './invitation-fixture.mjs'

test('acceptance is confirmed-email-bound, preserves other workspaces, and frees a slot', async () => {
  const f = await fixture()
  try {
    const sender = await f.user('sender')
    const recipient = await f.user('recipient')
    const wrong = await f.user('wrong')
    const workspace = await f.workspace(sender)
    const original = await f.workspace(recipient)
    const viewer = await f.role('workspace.viewer')
    const id = await f.invite(sender, workspace, viewer, ` ${recipient.email.toUpperCase()} `)
    assert.equal(unwrap(await admin.from('workspace_users').select('*').eq('workspace_id', workspace).eq('user_id', recipient.id)).length, 0)
    assert.equal((await anonymous().rpc('accept_workspace_invitation', { invitation_id: id })).error?.code, '42501')
    assert.equal((await recipient.client.rpc('accept_workspace_invitation', { invitation_id: id })).error?.code, 'P0002')
    await f.deliver(id)
    assert.equal((await wrong.client.rpc('accept_workspace_invitation', { invitation_id: id })).error?.code, '42501')
    const preview = unwrap(await recipient.client.rpc('get_workspace_invitation', { invitation_id: id }))
    assert.equal(preview.email, recipient.email)
    assert.equal(unwrap(await recipient.client.rpc('accept_workspace_invitation', { invitation_id: id })), workspace)
    assert.equal(unwrap(await recipient.client.rpc('accept_workspace_invitation', { invitation_id: id })), workspace, 'Acceptance must be idempotent')
    const memberships = unwrap(await recipient.client.rpc('list_my_workspaces'))
    assert.equal(memberships.length, 2)
    assert.equal(unwrap(await recipient.client.rpc('get_workspace_access', { target_workspace_id: workspace })).role_id, viewer)
    assert.ok(memberships.some(row => row.id === original))
    assert.equal(unwrap(await sender.client.rpc('list_my_workspace_invitations')).length, 0)
    assert.equal((await sender.client.rpc('create_workspace_invitation', {
      target_workspace_id: workspace, target_role_id: viewer, invited_email: recipient.email,
    })).error?.code, '23505')
    const canceled = await f.invite(sender, workspace, viewer, wrong.email)
    await f.deliver(canceled)
    unwrap(await sender.client.rpc('cancel_workspace_invitation', { invitation_id: canceled }))
    assert.equal((await wrong.client.rpc('accept_workspace_invitation', { invitation_id: canceled })).error?.code, 'P0002')
    const stale = await f.invite(sender, workspace, viewer, wrong.email)
    await f.deliver(stale)
    unwrap(await admin.from('workspace_users').delete().eq('workspace_id', workspace).eq('user_id', sender.id))
    assert.equal((await wrong.client.rpc('accept_workspace_invitation', { invitation_id: stale })).error?.code, '42501', 'Sender access must be rechecked')
    unwrap(await sender.client.rpc('cancel_workspace_invitation', { invitation_id: stale }))
    assert.equal(unwrap(await sender.client.rpc('list_my_workspace_invitations')).length, 0, 'A sender can cancel after losing workspace access')
    assert.ok((await recipient.client.from('workspace_invitations').insert({
      workspace_id: workspace, role_id: viewer, invited_by: recipient.id, email: wrong.email,
    })).error, 'Direct client invitation writes must remain blocked')
  } finally {
    await f.cleanup()
  }
})

test('invitation role scope and Owner assignment restrictions are enforced independently of the UI', async () => {
  const f = await fixture()
  try {
    const owner = await f.user('owner')
    const manager = await f.user('manager')
    const workspace = await f.workspace(owner)
    const otherWorkspace = await f.workspace(owner)
    const ownerRole = await f.role('workspace.owner')
    const role = unwrap(await owner.client.rpc('create_workspace_role', { target_workspace_id: workspace, role_name: 'Invitation manager' }))
    const permissions = unwrap(await admin.from('permissions').select('id').in('key', ['roles.read', 'roles.members.add']))
    unwrap(await owner.client.rpc('save_workspace_role_permissions', {
      target_workspace_id: workspace, target_role_id: role.id,
      permission_ids: permissions.map(permission => permission.id), expected_permission_ids: [],
    }))
    unwrap(await admin.from('workspace_users').insert({ workspace_id: workspace, user_id: manager.id, role_id: role.id }))
    const otherRole = unwrap(await owner.client.rpc('create_workspace_role', { target_workspace_id: otherWorkspace, role_name: 'Other workspace role' }))
    for (const roleId of [ownerRole, otherRole.id]) {
      assert.equal((await manager.client.rpc('create_workspace_invitation', {
        target_workspace_id: workspace, target_role_id: roleId, invited_email: `${f.prefix}-forbidden@example.com`,
      })).error?.code, '42501')
    }
    assert.equal(unwrap(await manager.client.rpc('list_my_workspace_invitations')).length, 0)
    await f.invite(manager, workspace, role.id, `${f.prefix}-allowed@example.com`)
    assert.equal(unwrap(await manager.client.rpc('list_my_workspace_invitations')).length, 1)
    const viewer = await f.role('workspace.viewer')
    unwrap(await admin.from('workspace_users').update({ role_id: viewer }).eq('workspace_id', workspace).eq('user_id', manager.id))
    assert.equal((await manager.client.rpc('create_workspace_invitation', {
      target_workspace_id: workspace, target_role_id: viewer, invited_email: `${f.prefix}-denied@example.com`,
    })).error?.code, '42501')
  } finally {
    await f.cleanup()
  }
})
