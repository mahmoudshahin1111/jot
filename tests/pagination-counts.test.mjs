import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, admin, anonymous, unwrap } from './invitation-fixture.mjs'

test('role and user counts match filtered listings, remain scoped, and follow mutations', async () => {
  const f = await fixture()
  try {
    const owner = await f.user('count-owner')
    const member = await f.user('count-member')
    const outsider = await f.user('count-outsider')
    const workspace = await f.workspace(owner)
    const otherWorkspace = await f.workspace(outsider)
    const args = { target_workspace_id: workspace }
    const rpc = async (name, extra = {}) => unwrap(await owner.client.rpc(name, { ...args, ...extra }))
    const role = await rpc('create_workspace_role', { role_name: 'Unique counter role' })
    const foreignRole = unwrap(await outsider.client.rpc('create_workspace_role', {
      target_workspace_id: otherWorkspace, role_name: 'Foreign counter role',
    }))
    unwrap(await admin.from('workspace_users').insert({
      workspace_id: workspace, user_id: member.id, role_id: role.id,
    }))
    assert.equal(await rpc('count_workspace_roles'), 4)
    assert.equal(await rpc('count_workspace_roles', { search_term: 'UNIQUE counter' }), 1)
    assert.equal(await rpc('count_workspace_roles', { search_term: 'Foreign counter' }), 0)
    assert.equal(await rpc('count_workspace_roles', { search_term: 'no matching role' }), 0)
    assert.equal(await rpc('count_workspace_roles', { search_term: null }), 4)
    const roles = await rpc('list_workspace_roles', { page_size: 1 })
    assert.equal('total' in roles, false)
    assert.equal(roles.roles.length, 2, 'Lookahead is preserved')
    const members = await rpc('list_workspace_role_members', { target_role_id: role.id })
    assert.deepEqual(members.members.map(row => row.user_id), [member.id])
    assert.equal('total' in members, false)
    assert.equal(await rpc('count_workspace_role_members', { target_role_id: role.id }), 1)
    assert.equal((await owner.client.rpc('count_workspace_role_members', {
      ...args, target_role_id: foreignRole.id,
    })).error?.code, '42501')
    const users = await rpc('list_workspace_users', { search_term: member.email.toUpperCase() })
    assert.deepEqual(users.members.map(row => row.user_id), [member.id])
    assert.equal('total' in users, false)
    assert.equal(await rpc('count_workspace_users', { search_term: member.email.toUpperCase() }), 1)
    assert.equal(await rpc('count_workspace_users', { search_term: 'no matches' }), 0)
    assert.equal(await rpc('count_workspace_users'), 2)
    const copy = await rpc('duplicate_workspace_role_details', { target_role_id: role.id })
    assert.equal(await rpc('count_workspace_roles'), 5)
    await rpc('assign_workspace_role_member', {
      target_role_id: copy.id, target_user_id: member.id, expected_role_id: role.id,
    })
    assert.equal(await rpc('count_workspace_role_members', { target_role_id: role.id }), 0)
    assert.equal(await rpc('count_workspace_role_members', { target_role_id: copy.id }), 1)
    await rpc('remove_workspace_role_member', { target_role_id: copy.id, target_user_id: member.id })
    assert.equal(await rpc('count_workspace_users'), 1)
    assert.equal(await rpc('count_workspace_role_members', { target_role_id: copy.id }), 0)
    await rpc('delete_workspace_role', { target_role_id: copy.id })
    assert.equal(await rpc('count_workspace_roles'), 4)
    for (const client of [anonymous(), outsider.client, member.client]) {
      for (const [name, extra] of [
        ['count_workspace_roles', {}], ['count_workspace_users', {}],
        ['count_workspace_role_members', { target_role_id: role.id }],
      ]) {
        assert.equal((await client.rpc(name, { ...args, ...extra })).error?.code, '42501', name)
      }
    }
  } finally {
    await f.cleanup()
  }
})

test('task, workspace and invitation count RPCs honor visibility, filters and lifecycle', async () => {
  const f = await fixture()
  try {
    const owner = await f.user('all-count-owner')
    const outsider = await f.user('all-count-outsider')
    const workspace = await f.workspace(owner)
    await f.workspace(outsider)
    const args = { target_workspace_id: workspace }
    const rpc = async (name, extra = {}) => unwrap(await owner.client.rpc(name, extra))
    assert.equal(await rpc('count_my_workspaces'), 1)
    assert.equal(await rpc('count_my_workspaces', { search_term: 'no matches' }), 0)
    const task = await rpc('create_workspace_task', { ...args, task_title: 'Count this task' })
    assert.equal(await rpc('count_workspace_tasks', args), 1)
    assert.deepEqual(await rpc('count_workspace_task_summary', args), { all: 1, todo: 1, in_progress: 0, done: 0 })
    await rpc('update_workspace_task', { ...args, target_task_id: task.id, task_status: 'done', task_description: 'Search summary' })
    assert.deepEqual(await rpc('count_workspace_task_summary', { ...args, search_term: 'SEARCH SUMMARY' }), {
      all: 1, todo: 0, in_progress: 0, done: 1,
    })
    assert.deepEqual(await rpc('count_workspace_task_summary', { ...args, search_term: 'no matches' }), {
      all: 0, todo: 0, in_progress: 0, done: 0,
    })
    await rpc('update_workspace_task', { ...args, target_task_id: task.id, task_status: 'todo' })
    assert.equal(await rpc('count_workspace_tasks', { ...args, search_term: 'COUNT THIS', task_status: 'todo' }), 1)
    assert.equal(await rpc('count_workspace_tasks', { ...args, task_status: 'done' }), 0)
    assert.equal((await owner.client.rpc('count_workspace_tasks', { ...args, task_status: 'invalid' })).error?.code, '22023')
    await rpc('delete_workspace_task', { ...args, target_task_id: task.id })
    assert.equal(await rpc('count_workspace_tasks', args), 0)
    assert.equal((await outsider.client.rpc('count_workspace_tasks', args)).error?.code, '42501')
    assert.equal((await outsider.client.rpc('count_workspace_task_summary', args)).error?.code, '42501')
    const invitation = await f.invite(owner, workspace, await f.role('workspace.viewer'), outsider.email)
    assert.equal(await rpc('count_my_workspace_invitations'), 1)
    assert.equal(unwrap(await outsider.client.rpc('count_my_workspace_invitations')), 0)
    await f.deliver(invitation)
    unwrap(await outsider.client.rpc('accept_workspace_invitation', { invitation_id: invitation }))
    assert.equal(await rpc('count_my_workspace_invitations'), 0)
    assert.equal(await rpc('count_workspace_users', args), 2)
    const canceled = await f.invite(owner, workspace, await f.role('workspace.viewer'), `${f.prefix}-cancel@example.com`)
    await rpc('cancel_workspace_invitation', { invitation_id: canceled })
    assert.equal(await rpc('count_my_workspace_invitations'), 0)
    const expired = await f.invite(owner, workspace, await f.role('workspace.viewer'), `${f.prefix}-expire@example.com`)
    unwrap(await admin.from('workspace_invitations').update({ expires_at: '2020-01-01T00:00:00Z' }).eq('id', expired))
    assert.equal(await rpc('count_my_workspace_invitations'), 0)
    for (const [name, extra] of [
      ['count_my_workspaces', {}], ['count_my_workspace_invitations', {}], ['count_workspace_tasks', args],
      ['count_workspace_task_summary', args],
    ]) assert.equal((await anonymous().rpc(name, extra)).error?.code, '42501')
    unwrap(await admin.from('workspace_users').delete().eq('workspace_id', workspace).eq('user_id', owner.id))
    assert.equal(await rpc('count_my_workspaces'), 0)
    assert.equal((await owner.client.rpc('count_workspace_users', args)).error?.code, '42501')
  } finally {
    await f.cleanup()
  }
})
