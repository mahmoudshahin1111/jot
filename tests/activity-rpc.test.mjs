import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, admin, anonymous, unwrap } from './invitation-fixture.mjs'

test('Activity RPC paginates tied timestamps with complete, filtered workspace counts', async () => {
  const f = await fixture()
  try {
    const owner = await f.user('activity-owner')
    const workspace = await f.workspace(owner)
    const otherWorkspace = await f.workspace(owner)
    const timestamp = '2026-10-16T00:00:00.123456Z'
    unwrap(await admin.from('workspace_activity_events').delete().eq('workspace_id', workspace))
    const seeded = unwrap(await admin.from('workspace_activity_events').insert(Array.from({ length: 45 }, (_, index) => ({
      workspace_id: workspace, event_type: 'task.updated', actor_name: 'Activity owner',
      description: `${index % 2 ? 'Changed' : 'Created'} task ${index}`, created_at: timestamp,
    }))).select('id'))
    unwrap(await admin.from('workspace_activity_events').insert({
      workspace_id: otherWorkspace, event_type: 'task.created', actor_name: 'Other owner',
      description: 'Created task in another workspace',
    }))
    const list = args => owner.client.rpc('list_workspace_activity_events', { target_workspace_id: workspace, ...args })
    const ids = []
    let cursor = {}
    for (;;) {
      const page = unwrap(await list({ page_size: 20, ...cursor }))
      assert.equal(page.total_count, 45)
      assert.ok(page.events.length <= 20)
      ids.push(...page.events.map(event => event.id))
      if (!page.has_more) break
      cursor = { before_created_at: page.next_cursor.created_at, before_id: page.next_cursor.id }
    }
    assert.equal(ids.length, 45)
    assert.equal(new Set(ids).size, 45)
    assert.deepEqual(new Set(ids), new Set(seeded.map(event => event.id)))
    assert.deepEqual(ids, [...ids].sort().reverse(), 'UUID breaks timestamp ties newest first')
    const filtered = unwrap(await list({ search_term: '  CREATED  ', page_size: 20 }))
    assert.equal(filtered.total_count, 23)
    assert.equal(filtered.has_more, true)
    const filteredNext = unwrap(await list({
      search_term: 'created', page_size: 20,
      before_created_at: filtered.next_cursor.created_at, before_id: filtered.next_cursor.id,
    }))
    assert.equal(filteredNext.total_count, 23)
    assert.equal(filteredNext.events.length, 3)
    assert.equal(filteredNext.has_more, false)
    assert.deepEqual(unwrap(await list({ search_term: 'no matches' })), {
      events: [], total_count: 0, has_more: false, next_cursor: null,
    })
    for (const args of [
      { page_size: 0 }, { page_size: 101 }, { page_size: null },
      { before_id: randomUUID() }, { before_created_at: timestamp },
    ]) assert.equal((await list(args)).error?.code, '22023')
  } finally {
    await f.cleanup()
  }
})

test('Activity RPC rejects unauthorized callers and records task RPC mutations persistently', async () => {
  const f = await fixture()
  try {
    const owner = await f.user('activity-mutations-owner')
    const viewer = await f.user('activity-viewer')
    const outsider = await f.user('activity-outsider')
    const workspace = await f.workspace(owner)
    unwrap(await admin.from('workspace_users').insert({
      workspace_id: workspace, user_id: viewer.id, role_id: await f.role('workspace.viewer'),
    }))
    for (const client of [anonymous(), viewer.client, outsider.client]) {
      assert.equal((await client.rpc('list_workspace_activity_events', { target_workspace_id: workspace })).error?.code, '42501')
    }
    const task = unwrap(await owner.client.rpc('create_workspace_task', { target_workspace_id: workspace, task_title: 'Activity mutation' }))
    unwrap(await owner.client.rpc('update_workspace_task', {
      target_workspace_id: workspace, target_task_id: task.id, task_status: 'done',
    }))
    unwrap(await owner.client.rpc('delete_workspace_task', { target_workspace_id: workspace, target_task_id: task.id }))
    const page = unwrap(await owner.client.rpc('list_workspace_activity_events', {
      target_workspace_id: workspace, search_term: 'Activity mutation',
    }))
    assert.equal(page.total_count, 3)
    assert.deepEqual(page.events.map(event => event.event_type), ['task.deleted', 'task.updated', 'task.created'])
    assert.ok(page.events.every(event => event.actor_user_id === owner.id && event.affected_item_id === task.id))
    unwrap(await admin.from('workspace_users').delete().eq('workspace_id', workspace).eq('user_id', owner.id))
    assert.equal((await owner.client.rpc('list_workspace_activity_events', { target_workspace_id: workspace })).error?.code, '42501')
  } finally {
    await f.cleanup()
  }
})
