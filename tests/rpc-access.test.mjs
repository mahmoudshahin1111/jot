import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, admin, anonymous, unwrap } from './invitation-fixture.mjs'

test('table CRUD is denied over the API even for workspace owners', async () => {
  const f = await fixture()
  try {
    const owner = await f.user('rpc-owner')
    await f.workspace(owner)
    const tables = ['workspaces', 'workspace_users', 'roles', 'permissions', 'role_permissions', 'tasks', 'workspace_invitations']
    for (const client of [anonymous(), owner.client]) {
      for (const table of tables) {
        const column = table === 'workspace_users' ? 'workspace_id' : table === 'role_permissions' ? 'role_id' : 'id'
        for (const request of [
          client.from(table).select('*').limit(1),
          client.from(table).insert({ [column]: randomUUID() }),
          client.from(table).update({ [column]: randomUUID() }).eq(column, randomUUID()),
          client.from(table).delete().eq(column, randomUUID()),
        ]) {
          assert.equal((await request).error?.code, '42501', `Direct CRUD denied on ${table}`)
        }
      }
    }
  } finally {
    await f.cleanup()
  }
})

test('task RPCs enforce permissions, scope, validation and exact mutations', async () => {
  const f = await fixture()
  try {
    const owner = await f.user('task-rpc-owner')
    const editor = await f.user('task-rpc-editor')
    const viewer = await f.user('task-rpc-viewer')
    const outsider = await f.user('task-rpc-outsider')
    const workspace = await f.workspace(owner)
    const otherWorkspace = await f.workspace(owner)
    unwrap(await admin.from('workspace_users').insert([
      { workspace_id: workspace, user_id: editor.id, role_id: await f.role('workspace.editor') },
      { workspace_id: workspace, user_id: viewer.id, role_id: await f.role('workspace.viewer') },
    ]))
    const create = { target_workspace_id: workspace, task_title: '  Created using RPC  ' }
    const task = unwrap(await editor.client.rpc('create_workspace_task', create))
    assert.deepEqual(task, { id: task.id, title: 'Created using RPC', description: '', status: 'todo' })
    const target = { target_workspace_id: workspace, target_task_id: task.id }
    const update = { ...target, task_status: 'in_progress', task_title: '  Edited title  ', task_description: 'Saved description' }
    const updated = unwrap(await editor.client.rpc('update_workspace_task', update))
    assert.deepEqual(updated, { ...task, title: 'Edited title', description: 'Saved description', status: 'in_progress' })
    const done = unwrap(await editor.client.rpc('update_workspace_task', { ...target, task_status: 'done' }))
    assert.deepEqual(done, { ...updated, status: 'done' }, 'Status-only save preserves text')
    const listed = unwrap(await viewer.client.rpc('list_workspace_tasks', { target_workspace_id: workspace }))
    assert.deepEqual(listed.map(({ created_at: _createdAt, ...row }) => row), [done])
    for (const client of [anonymous(), outsider.client]) {
      for (const [name, args] of [
        ['list_workspace_tasks', { target_workspace_id: workspace }],
        ['create_workspace_task', create],
        ['update_workspace_task', update],
        ['delete_workspace_task', target],
      ]) assert.equal((await client.rpc(name, args)).error?.code, '42501')
    }
    for (const [name, args] of [['create_workspace_task', create], ['update_workspace_task', update], ['delete_workspace_task', target]]) {
      assert.equal((await viewer.client.rpc(name, args)).error?.code, '42501')
    }
    assert.equal((await editor.client.rpc('delete_workspace_task', target)).error?.code, '42501')
    assert.equal((await owner.client.rpc('create_workspace_task', { ...create, task_title: ' ' })).error?.code, '22023')
    assert.equal((await owner.client.rpc('create_workspace_task', { ...create, task_title: null })).error?.code, '22023')
    for (const invalid of [{ task_title: '' }, { task_status: 'invalid' }, { task_status: null }]) {
      assert.equal((await owner.client.rpc('update_workspace_task', { ...update, ...invalid })).error?.code, '22023')
    }
    for (const missing of [{ ...target, target_task_id: randomUUID() }, { ...target, target_workspace_id: otherWorkspace }]) {
      assert.equal((await owner.client.rpc('update_workspace_task', { ...missing, task_status: 'done' })).error?.code, 'P0002')
      assert.equal((await owner.client.rpc('delete_workspace_task', missing)).error?.code, 'P0002')
    }
    unwrap(await admin.from('workspace_users').delete().eq('workspace_id', workspace).eq('user_id', editor.id))
    assert.equal((await editor.client.rpc('update_workspace_task', update)).error?.code, '42501', 'Revocation takes effect immediately')
    assert.deepEqual(unwrap(await owner.client.rpc('delete_workspace_task', target)), { id: task.id })
    assert.equal(unwrap(await owner.client.rpc('list_workspace_tasks', { target_workspace_id: workspace })).length, 0)
    assert.equal((await owner.client.rpc('delete_workspace_task', target)).error?.code, 'P0002')
  } finally {
    await f.cleanup()
  }
})

test('workspace and task list RPCs enforce page limits and stable cursor traversal', async () => {
  const f = await fixture()
  try {
    const owner = await f.user('rpc-pagination-owner')
    const outsider = await f.user('rpc-pagination-outsider')
    const workspace = await f.workspace(owner)
    await f.workspace(owner)
    await f.workspace(owner)
    await f.workspace(outsider)
    const timestamp = '2026-10-16T00:00:00.123456Z'
    const memberships = unwrap(await admin.from('workspace_users').select('workspace_id').eq('user_id', owner.id))
    unwrap(await admin.from('workspaces').update({ created_at: timestamp }).in('id', memberships.map(row => row.workspace_id)))
    const rows = unwrap(await admin.from('tasks').insert(Array.from({ length: 205 }, (_, index) => ({
      workspace_id: workspace, title: `Paginated task ${index}`, created_at: timestamp,
    }))).select('id'))
    for (const [name, args, expected] of [
      ['list_workspace_tasks', { target_workspace_id: workspace }, 205],
      ['list_my_workspaces', {}, 3],
    ]) {
      for (const page_size of [0, -1, 101, null]) {
        assert.equal((await owner.client.rpc(name, { ...args, page_size })).error?.code, '22023')
      }
      for (const cursor of [{ after_id: randomUUID() }, { after_created_at: timestamp }]) {
        assert.equal((await owner.client.rpc(name, { ...args, ...cursor })).error?.code, '22023')
      }
      const ids = []
      let after = {}
      const pageSize = name === 'list_workspace_tasks' ? 100 : 2
      for (;;) {
        const page = unwrap(await owner.client.rpc(name, { ...args, ...after, page_size: pageSize }))
        assert.ok(page.length <= pageSize)
        ids.push(...page.map(row => row.id))
        if (page.length < pageSize) break
        const last = page.at(-1)
        after = { after_created_at: last.created_at, after_id: last.id }
      }
      assert.equal(ids.length, expected)
      assert.equal(new Set(ids).size, expected, 'No duplicates or omissions when timestamps tie')
      if (name === 'list_workspace_tasks') assert.deepEqual(new Set(ids), new Set(rows.map(row => row.id)))
      assert.equal((await anonymous().rpc(name, args)).error?.code, '42501')
    }
    const role = unwrap(await owner.client.rpc('duplicate_workspace_role_details', {
      target_workspace_id: workspace, target_role_id: await f.role('workspace.viewer'),
    }))
    assert.equal(role.name, 'Viewer (copy)')
    assert.equal(role.member_count, 0)
    assert.deepEqual(role.permission_ids, [unwrap(await admin.from('permissions').select('id').eq('key', 'tasks.read').single()).id])
    unwrap(await admin.from('workspace_users').delete().eq('workspace_id', workspace).eq('user_id', owner.id))
    assert.equal(unwrap(await owner.client.rpc('list_my_workspaces')).length, 2)
    assert.equal(unwrap(await owner.client.rpc('get_workspace_access', { target_workspace_id: workspace })), null)
    assert.equal((await owner.client.rpc('list_workspace_tasks', { target_workspace_id: workspace })).error?.code, '42501')
  } finally {
    await f.cleanup()
  }
})
