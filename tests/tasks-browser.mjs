import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { fixture, admin, unwrap } from './invitation-fixture.mjs'

test('Tasks loads all bounded RPC pages for complete counts and description search', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('tasks-pagination-owner')
    const workspaceId = await f.workspace(owner)
    const tasks = unwrap(await admin.from('tasks').insert(Array.from({ length: 205 }, (_, index) => ({
      workspace_id: workspaceId, title: `Paged task ${index}`, created_at: '2026-10-16T00:00:00.123456Z',
    }))).select('id, title'))
    const lastTask = tasks.sort((a, b) => a.id.localeCompare(b.id)).at(-1)
    unwrap(await admin.from('tasks').update({ status: 'done', description: 'Beyond first page' }).eq('id', lastTask.id))
    const context = await browser.newContext()
    const page = await context.newPage()
    const requests = []
    page.on('request', request => {
      if (request.url().includes('/rest/v1/')) requests.push(request)
    })
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/tasks`)
    const filters = page.getByRole('group', { name: 'Filter tasks by status' })
    await filters.getByRole('button', { name: 'All 205', exact: true }).waitFor()
    await filters.getByRole('button', { name: 'Done 1', exact: true }).waitFor()
    await page.getByText('205 tasks in this workspace, 1 done', { exact: true }).waitFor()
    const countCalls = () => requests.filter(request =>
      request.method() === 'POST' && request.url().endsWith('/rpc/count_workspace_task_summary'))
    assert.ok(countCalls().length > 0, 'Task counts load through a separate RPC')
    assert.equal(new Set(countCalls().map(request => request.postDataJSON().search_term)).size, 1,
      'Loading multiple record pages only requests the unfiltered count')
    await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('BEYOND FIRST PAGE')
    await page.getByRole('table', { name: 'Workspace tasks' }).getByRole('button', { name: lastTask.title, exact: true }).waitFor()
    await page.getByRole('table', { name: 'Workspace tasks' }).getByRole('button', { name: 'Done (1)', exact: true }).waitFor()
    assert.ok(countCalls().some(request => request.postDataJSON().search_term === 'beyond first page'))
    const filteredCountCalls = countCalls().length
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    await page.getByRole('region', { name: 'Task board' }).waitFor()
    await filters.getByRole('button', { name: 'Done 1', exact: true }).click()
    assert.equal(countCalls().length, filteredCountCalls, 'View and status selection reuse the summary')
    await page.route('**/rest/v1/rpc/count_workspace_task_summary', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Task count unavailable' }) })
      } else await route.continue()
    })
    await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('paged')
    await page.getByRole('alert').filter({ hasText: 'Task count unavailable' }).waitFor()
    await page.getByRole('region', { name: 'Task board' }).getByRole('button', { name: `Open task: ${lastTask.title}`, exact: true }).waitFor()
    await page.unroute('**/rest/v1/rpc/count_workspace_task_summary')
    await page.getByRole('button', { name: 'Retry matching counts', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Task count unavailable' }).waitFor({ state: 'detached' })
    assert.ok(requests.every(request => new URL(request.url()).pathname.startsWith('/rest/v1/rpc/')), 'Browser never queries application tables')
    const pages = requests.filter(request => request.url().endsWith('/rpc/list_workspace_tasks')).map(request => request.postDataJSON())
    assert.ok(pages.every(args => args.page_size === 100))
    assert.equal(new Set(pages.map(args => args.after_id)).size, 3, 'Client traverses every page')
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})

for (const view of ['list', 'board']) {
test(`Tasks ${view} drag between groups updates immediately and debounces status persistence`, async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('task-drag-owner')
    const workspaceId = await f.workspace(owner)
    const task = unwrap(await admin.from('tasks').insert({
      workspace_id: workspaceId, title: 'Drag this task',
    }).select('id').single())
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/tasks`)
    if (view === 'board') await page.getByRole('button', { name: 'Board', exact: true }).click()
    const table = view === 'board'
      ? page.getByRole('region', { name: 'Task board', exact: true })
      : page.getByRole('table', { name: 'Workspace tasks' })
    const taskButtonName = view === 'board' ? 'Open task: Drag this task' : 'Drag this task'
    const row = view === 'board'
      ? table.getByRole('button', { name: taskButtonName, exact: true })
      : table.getByRole('row').filter({ has: page.getByRole('button', { name: taskButtonName, exact: true }) })
    const group = name => table.getByRole(view === 'board' ? 'region' : 'rowgroup', { name, exact: true })
    await row.waitFor()
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    let patches = 0
    await page.route('**/rest/v1/rpc/update_workspace_task', async route => {
      if (route.request().method() === 'POST') patches++
      await route.continue()
    })
    await row.dragTo(group('In progress'))
    await group('In progress').getByRole('button', { name: taskButtonName, exact: true }).waitFor()
    assert.equal(patches, 0)
    assert.equal(unwrap(await admin.from('tasks').select('status').eq('id', task.id).single()).status, 'todo')
    await row.dragTo(group('Done'))
    await group('Done').getByRole('button', { name: taskButtonName, exact: true }).waitFor()
    await page.clock.runFor(499)
    assert.equal(patches, 0, 'No save before 500 ms')
    await page.clock.runFor(1)
    await page.getByText('Task status updated.', { exact: true }).waitFor()
    assert.equal(patches, 1, 'Rapid drops coalesce into one status update')
    assert.equal(unwrap(await admin.from('tasks').select('status').eq('id', task.id).single()).status, 'done')
    await page.unroute('**/rest/v1/rpc/update_workspace_task')
    await page.route('**/rest/v1/rpc/update_workspace_task', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Move denied', code: '42501' }) })
      } else await route.continue()
    })
    await row.dragTo(group('To do'))
    await group('To do').getByRole('button', { name: taskButtonName, exact: true }).waitFor()
    await page.clock.runFor(500)
    await page.getByRole('alert').filter({ hasText: 'Move denied' }).waitFor()
    await group('Done').getByRole('button', { name: taskButtonName, exact: true }).waitFor()
    assert.equal(unwrap(await admin.from('tasks').select('status').eq('id', task.id).single()).status, 'done')
    await page.unroute('**/rest/v1/rpc/update_workspace_task')
    await page.reload()
    if (view === 'board') await page.getByRole('button', { name: 'Board', exact: true }).click()
    await group('Done').getByRole('button', { name: taskButtonName, exact: true }).waitFor()
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})
}

test('Board shares details editing, search, filters, creation, deletion, and responsive layout', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('board-owner')
    const workspaceId = await f.workspace(owner)
    const task = unwrap(await admin.from('tasks').insert({
      workspace_id: workspaceId, title: 'Board ticket', description: 'Searchable description',
    }).select('id').single())
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    page.on('dialog', dialog => dialog.accept())
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/tasks`)
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    const board = page.getByRole('region', { name: 'Task board', exact: true })
    await board.waitFor()
    assert.equal(await board.getByRole('region').count(), 3)
    assert.equal(await board.getByText('No tasks in this group.', { exact: true }).count(), 2)
    await board.getByRole('button', { name: 'Open task: Board ticket', exact: true }).click()
    const details = page.getByRole('region', { name: 'Task details', exact: true })
    await details.waitFor()
    const boardBox = await board.boundingBox()
    const detailsBox = await details.boundingBox()
    assert.ok(detailsBox.x > boardBox.x + boardBox.width)
    await details.getByLabel('Title', { exact: true }).fill('Board title edited')
    await details.getByLabel('Description', { exact: true }).fill('Board description edited')
    await page.getByRole('button', { name: 'List', exact: true }).click()
    assert.equal(await details.getByLabel('Title', { exact: true }).inputValue(), 'Board title edited')
    await details.getByText('All changes saved.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    await details.getByRole('button', { name: 'Done', exact: true }).click()
    await board.getByRole('region', { name: 'Done', exact: true })
      .getByRole('button', { name: 'Open task: Board title edited', exact: true }).waitFor()
    const persisted = unwrap(await admin.from('tasks').select('title, description, status').eq('id', task.id).single())
    assert.deepEqual(persisted, { title: 'Board title edited', description: 'Board description edited', status: 'done' })
    const search = page.getByRole('searchbox', { name: 'Search tasks', exact: true })
    await search.fill('DESCRIPTION EDITED')
    assert.equal(await board.getByRole('button', { name: 'Open task: Board title edited', exact: true }).count(), 1)
    await search.fill('does not exist')
    assert.equal(await board.getByText('No matching tasks in this group.', { exact: true }).count(), 3)
    await search.fill('')
    const filters = page.getByRole('group', { name: 'Filter tasks by status' })
    await filters.getByRole('button', { name: 'Done 1', exact: true }).click()
    assert.equal(await board.getByRole('region').count(), 1)
    await filters.getByRole('button', { name: 'All 1', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    const mobileBoardBox = await board.boundingBox()
    const mobileDetailsBox = await details.boundingBox()
    assert.ok(mobileDetailsBox.y > mobileBoardBox.y + mobileBoardBox.height)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await details.getByRole('button', { name: 'Close task details', exact: true }).click()
    await details.waitFor({ state: 'detached' })
    await page.getByRole('textbox', { name: 'Task name', exact: true }).fill('Created on board')
    await page.getByRole('button', { name: 'Add task', exact: true }).click()
    await board.getByRole('region', { name: 'To do', exact: true })
      .getByRole('button', { name: 'Open task: Created on board', exact: true }).waitFor()
    await board.getByRole('button', { name: 'Open task: Board title edited', exact: true }).click()
    await details.getByRole('button', { name: 'Delete task', exact: true }).click()
    await details.waitFor({ state: 'detached' })
    assert.equal(await board.getByRole('button', { name: 'Open task: Board title edited', exact: true }).count(), 0)
    assert.equal(unwrap(await admin.from('tasks').select('id').eq('id', task.id)).length, 0)
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})

test('Tasks combines status filters with title and description search', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('task-filter-owner')
    const workspaceId = await f.workspace(owner)
    unwrap(await admin.from('tasks').insert([
      { workspace_id: workspaceId, title: 'Alpha task', description: 'First description', status: 'todo' },
      { workspace_id: workspaceId, title: 'Beta task', description: 'Contains ALPHA in description', status: 'in_progress' },
      { workspace_id: workspaceId, title: 'Gamma task', description: 'Finished item', status: 'done' },
    ]))
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/tasks`)
    const table = page.getByRole('table', { name: 'Workspace tasks' })
    await table.waitFor()
    const filters = page.getByRole('group', { name: 'Filter tasks by status' })
    const search = page.getByRole('searchbox', { name: 'Search tasks', exact: true })
    assert.equal(await page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'List', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('button', { name: 'Board', exact: true }).getAttribute('aria-pressed'), 'false')
    await filters.getByRole('button', { name: 'All 3', exact: true }).waitFor()
    for (const [label, title] of [['To do', 'Alpha task'], ['In progress', 'Beta task'], ['Done', 'Gamma task']]) {
      await filters.getByRole('button', { name: `${label} 1`, exact: true }).click()
      assert.equal(await table.locator('tbody').count(), 1)
      assert.equal(await table.getByRole('button', { name: title, exact: true }).count(), 1)
      assert.equal(await filters.getByRole('button', { name: `${label} 1`, exact: true }).getAttribute('aria-pressed'), 'true')
    }
    await filters.getByRole('button', { name: 'All 3', exact: true }).click()
    await search.fill('  aLpHa  ')
    assert.equal(await table.getByRole('button', { name: 'Alpha task', exact: true }).count(), 1)
    assert.equal(await table.getByRole('button', { name: 'Beta task', exact: true }).count(), 1)
    assert.equal(await table.getByRole('button', { name: 'Gamma task', exact: true }).count(), 0)
    await filters.getByRole('button', { name: 'In progress 1', exact: true }).click()
    assert.equal(await table.locator('tbody').count(), 1)
    assert.equal(await table.getByRole('button', { name: 'Beta task', exact: true }).count(), 1)
    await search.fill('absent')
    await table.getByText('No matching tasks in this group.', { exact: true }).waitFor()
    await search.fill('')
    await table.getByRole('button', { name: 'Beta task', exact: true }).click()
    const details = page.getByRole('region', { name: 'Task details', exact: true })
    await details.getByLabel('Description', { exact: true }).fill('Draft preserved across filters')
    await filters.getByRole('button', { name: 'Done 1', exact: true }).click()
    assert.equal(await details.getByLabel('Description', { exact: true }).inputValue(), 'Draft preserved across filters')
    await details.getByText('All changes saved.', { exact: true }).waitFor()
    await details.getByRole('button', { name: 'Done', exact: true }).click()
    await filters.getByRole('button', { name: 'Done 2', exact: true }).waitFor()
    await table.getByRole('button', { name: 'Beta task', exact: true }).waitFor()
    await filters.getByRole('button', { name: 'In progress 0', exact: true }).click()
    await table.getByText('No tasks in this group.', { exact: true }).waitFor()
    await filters.getByRole('button', { name: 'All 3', exact: true }).click()
    await details.getByRole('button', { name: 'Close task details', exact: true }).click()
    await page.getByRole('textbox', { name: 'Task name', exact: true }).fill('New filtered task')
    await page.getByRole('button', { name: 'Add task', exact: true }).click()
    await filters.getByRole('button', { name: 'All 4', exact: true }).waitFor()
    await filters.getByRole('button', { name: 'To do 2', exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})

test('Tasks keeps empty status groups visible and creates persistent tasks from the inline form', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('tasks-owner')
    const viewer = await f.user('tasks-viewer')
    const outsider = await f.user('tasks-outsider')
    const workspaceId = await f.workspace(owner)
    const otherWorkspaceId = await f.workspace(outsider)
    const viewerRole = await f.role('workspace.viewer')
    unwrap(await admin.from('workspace_users').insert({ workspace_id: workspaceId, user_id: viewer.id, role_id: viewerRole }))
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/tasks`)
    const table = page.getByRole('table', { name: 'Workspace tasks' })
    await table.waitFor()
    assert.equal(await table.getByText('No tasks in this group.', { exact: true }).count(), 3)
    for (const label of ['To do (0)', 'In progress (0)', 'Done (0)']) {
      await table.getByRole('button', { name: label, exact: true }).waitFor()
    }
    const input = page.getByRole('textbox', { name: 'Task name', exact: true })
    const add = page.getByRole('button', { name: 'Add task', exact: true })
    await input.fill('   ')
    await add.click()
    await page.getByRole('alert').filter({ hasText: 'Task name is required.' }).waitFor()
    assert.equal(unwrap(await admin.from('tasks').select('id').eq('workspace_id', workspaceId)).length, 0)
    await input.fill('  First workspace task  ')
    await add.click()
    await table.getByRole('cell', { name: 'First workspace task', exact: true }).waitFor()
    await table.getByRole('button', { name: 'To do (1)', exact: true }).waitFor()
    assert.equal(await input.inputValue(), '')
    assert.equal(await table.getByText('No tasks in this group.', { exact: true }).count(), 2)
    const saved = unwrap(await admin.from('tasks').select('title, description, status').eq('workspace_id', workspaceId))
    assert.deepEqual(saved, [{ title: 'First workspace task', description: '', status: 'todo' }])

    await table.getByRole('button', { name: 'To do (1)', exact: true }).click()
    await table.getByRole('cell', { name: 'First workspace task', exact: true }).waitFor({ state: 'detached' })
    await input.fill('Created with Enter')
    await input.press('Enter')
    await table.getByRole('cell', { name: 'Created with Enter', exact: true }).waitFor()
    await page.reload()
    await table.getByRole('button', { name: 'To do (2)', exact: true }).waitFor()
    await table.getByRole('cell', { name: 'First workspace task', exact: true }).waitFor()

    await page.route('**/rest/v1/rpc/create_workspace_task', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Task creation denied', code: '42501' }) })
      } else await route.continue()
    })
    await input.fill('Keep this draft')
    await add.click()
    await page.getByRole('alert').filter({ hasText: 'Task creation denied' }).waitFor()
    assert.equal(await input.inputValue(), 'Keep this draft')
    assert.equal(await table.getByRole('cell', { name: 'Keep this draft', exact: true }).count(), 0)
    await page.unroute('**/rest/v1/rpc/create_workspace_task')
    unwrap(await admin.from('tasks').insert([
      { workspace_id: workspaceId, title: 'Work underway', status: 'in_progress', description: 'In progress description' },
      { workspace_id: workspaceId, title: 'Finished work', status: 'done', description: '' },
    ]))
    await page.reload()
    await table.getByRole('button', { name: 'In progress (1)', exact: true }).waitFor()
    await table.getByRole('button', { name: 'Done (1)', exact: true }).waitFor()
    assert.equal(await table.getByRole('rowgroup', { name: 'In progress', exact: true })
      .getByRole('cell', { name: 'Work underway', exact: true }).count(), 1)
    assert.equal(await table.getByRole('rowgroup', { name: 'Done', exact: true })
      .getByRole('cell', { name: 'Finished work', exact: true }).count(), 1)

    assert.equal((await viewer.client.rpc('create_workspace_task', { target_workspace_id: workspaceId, task_title: 'Forbidden viewer task' })).error?.code, '42501')
    assert.equal((await outsider.client.rpc('create_workspace_task', { target_workspace_id: workspaceId, task_title: 'Forbidden outsider task' })).error?.code, '42501')
    assert.equal((await owner.client.rpc('create_workspace_task', { target_workspace_id: otherWorkspaceId, task_title: 'Wrong workspace' })).error?.code, '42501')
    assert.equal((await owner.client.rpc('create_workspace_task', { target_workspace_id: workspaceId, task_title: '   ' })).error?.code, '22023')
    const editor = await f.user('tasks-editor')
    unwrap(await admin.from('workspace_users').insert({
      workspace_id: workspaceId, user_id: editor.id, role_id: await f.role('workspace.editor'),
    }))
    unwrap(await editor.client.rpc('create_workspace_task', { target_workspace_id: workspaceId, task_title: 'Editor task' }))

    const viewerContext = await browser.newContext()
    const viewerPage = await viewerContext.newPage()
    await viewerPage.goto('http://localhost:5173/login')
    await viewerPage.getByLabel('Email', { exact: true }).fill(viewer.email)
    await viewerPage.getByLabel('Password', { exact: true }).fill(viewer.password)
    await viewerPage.getByRole('button', { name: 'Sign in', exact: true }).click()
    await viewerPage.waitForURL(url => url.pathname === '/workspaces')
    await viewerPage.goto(`http://localhost:5173/workspaces/${workspaceId}/tasks`)
    await viewerPage.getByRole('table', { name: 'Workspace tasks' }).waitFor()
    assert.equal(await viewerPage.getByRole('textbox', { name: 'Task name', exact: true }).count(), 0)
    assert.equal(await viewerPage.getByRole('button', { name: 'Add task', exact: true }).count(), 0)
    assert.equal(await viewerPage.getByRole('checkbox').first().isDisabled(), true)
    assert.equal(await viewerPage.getByRole('button', { name: 'First workspace task', exact: true }).locator('..').locator('..').getAttribute('draggable'), 'false')
    await viewerPage.getByRole('button', { name: 'First workspace task', exact: true }).click()
    const viewerDetails = viewerPage.getByRole('region', { name: 'Task details', exact: true })
    await viewerDetails.waitFor()
    assert.equal(await viewerDetails.getByLabel('Title', { exact: true }).getAttribute('readonly'), '')
    assert.equal(await viewerDetails.getByLabel('Description', { exact: true }).getAttribute('readonly'), '')
    assert.equal(await viewerDetails.getByRole('button', { name: 'Done', exact: true }).isDisabled(), true)
    assert.equal(await viewerDetails.getByRole('button', { name: 'Delete task', exact: true }).count(), 0)
    await viewerPage.getByRole('button', { name: 'Board', exact: true }).click()
    const viewerBoard = viewerPage.getByRole('region', { name: 'Task board', exact: true })
    assert.equal(await viewerBoard.getByRole('button', { name: 'Open task: First workspace task', exact: true }).getAttribute('draggable'), 'false')
    await viewerDetails.getByRole('button', { name: 'Close task details', exact: true }).click()
    await viewerBoard.getByRole('button', { name: 'Open task: First workspace task', exact: true }).click()
    assert.equal(await viewerDetails.getByRole('button', { name: 'Done', exact: true }).isDisabled(), true)
    assert.equal(await viewerDetails.getByRole('button', { name: 'Delete task', exact: true }).count(), 0)
    await viewerContext.close()
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})

test('Tasks supports completion, debounced details, safe switching, and deletion', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('task-edit-owner')
    const viewer = await f.user('task-edit-viewer')
    const editor = await f.user('task-edit-editor')
    const outsider = await f.user('task-edit-outsider')
    const workspaceId = await f.workspace(owner)
    unwrap(await admin.from('workspace_users').insert([
      { workspace_id: workspaceId, user_id: viewer.id, role_id: await f.role('workspace.viewer') },
      { workspace_id: workspaceId, user_id: editor.id, role_id: await f.role('workspace.editor') },
    ]))
    const [first, second] = unwrap(await admin.from('tasks').insert([
      { workspace_id: workspaceId, title: 'First editable task' },
      { workspace_id: workspaceId, title: 'Second editable task' },
    ]).select('id, title'))
    const persisted = async () => unwrap(await admin.from('tasks').select('title, description, status').eq('id', first.id).single())
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    page.on('dialog', dialog => dialog.accept())
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/tasks`)
    const table = page.getByRole('table', { name: 'Workspace tasks' })
    await table.getByRole('checkbox', { name: 'First editable task completed', exact: true }).click()
    await table.getByRole('rowgroup', { name: 'Done', exact: true }).getByRole('button', { name: first.title, exact: true }).waitFor()
    assert.equal((await persisted()).status, 'done')
    await table.getByRole('checkbox', { name: 'First editable task completed', exact: true }).click()
    await table.getByRole('rowgroup', { name: 'To do', exact: true }).getByRole('button', { name: first.title, exact: true }).waitFor()
    assert.equal((await persisted()).status, 'todo')
    assert.equal(await page.getByRole('region', { name: 'Task details', exact: true }).count(), 0, 'Checkbox does not open details')

    await table.getByRole('button', { name: first.title, exact: true }).click()
    const details = page.getByRole('region', { name: 'Task details', exact: true })
    const title = details.getByLabel('Title', { exact: true })
    const description = details.getByLabel('Description', { exact: true })
    await details.waitFor()
    const tableBox = await table.boundingBox()
    const detailsBox = await details.boundingBox()
    assert.ok(detailsBox.x > tableBox.x + tableBox.width, 'Details appear beside the table on desktop')
    let patches = 0
    await page.route('**/rest/v1/rpc/update_workspace_task', async route => {
      if (route.request().method() === 'POST') patches++
      await route.continue()
    })
    await title.fill('Renamed')
    await title.fill('Renamed task')
    await description.fill('Updated description')
    await details.getByRole('button', { name: 'In progress', exact: true }).click()
    await details.getByText('All changes saved.', { exact: true }).waitFor()
    assert.equal(patches, 1, 'Rapid edits are batched into one debounced request')
    assert.deepEqual(await persisted(), { title: 'Renamed task', description: 'Updated description', status: 'in_progress' })
    await table.getByRole('rowgroup', { name: 'In progress', exact: true }).getByRole('button', { name: 'Renamed task', exact: true }).waitFor()
    await page.unroute('**/rest/v1/rpc/update_workspace_task')

    await title.fill('   ')
    await details.getByRole('alert').filter({ hasText: 'Task name is required.' }).first().waitFor()
    await details.getByRole('button', { name: 'Close task details', exact: true }).click()
    assert.equal(await details.count(), 1, 'Invalid draft prevents closing')
    assert.equal((await persisted()).title, 'Renamed task')
    await title.fill('Renamed task')
    await description.fill('Saved before switching')
    await table.getByRole('button', { name: second.title, exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#task-title')?.value === 'Second editable task')
    assert.equal((await persisted()).description, 'Saved before switching')
    await table.getByRole('button', { name: 'Renamed task', exact: true }).click()

    await page.route('**/rest/v1/rpc/update_workspace_task', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Save denied', code: '42501' }) })
      } else await route.continue()
    })
    await description.fill('Retained failed draft')
    await details.getByRole('alert').filter({ hasText: 'Save denied' }).waitFor()
    assert.equal(await description.inputValue(), 'Retained failed draft')
    assert.equal((await persisted()).description, 'Saved before switching')
    await page.unroute('**/rest/v1/rpc/update_workspace_task')
    await details.getByRole('button', { name: 'Retry saving', exact: true }).click()
    await details.getByText('All changes saved.', { exact: true }).waitFor()

    let release
    const gate = new Promise(resolve => { release = resolve })
    let started
    const requestStarted = new Promise(resolve => { started = resolve })
    let delayed = false
    await page.route('**/rest/v1/rpc/update_workspace_task', async route => {
      if (route.request().method() === 'POST' && !delayed) {
        delayed = true
        started()
        await gate
      }
      await route.continue()
    })
    await description.fill('First in-flight edit')
    await requestStarted
    await description.fill('Newest in-flight edit')
    await details.getByRole('button', { name: 'Close task details', exact: true }).click()
    release()
    await details.waitFor({ state: 'detached' })
    assert.equal((await persisted()).description, 'Newest in-flight edit', 'Close waits for newer edits during an in-flight save')
    await page.unroute('**/rest/v1/rpc/update_workspace_task')
    await page.reload()
    await table.getByRole('button', { name: 'Renamed task', exact: true }).click()
    assert.equal(await description.inputValue(), 'Newest in-flight edit')
    await details.getByRole('button', { name: 'Done', exact: true }).click()
    await details.getByText('All changes saved.', { exact: true }).waitFor()
    await table.getByRole('rowgroup', { name: 'Done', exact: true }).getByRole('button', { name: 'Renamed task', exact: true }).waitFor()
    assert.equal((await persisted()).status, 'done')

    await page.setViewportSize({ width: 390, height: 844 })
    const mobileTableBox = await table.boundingBox()
    const mobileDetailsBox = await details.boundingBox()
    assert.ok(mobileDetailsBox.y > mobileTableBox.y + mobileTableBox.height, 'Details stack below the list on mobile')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile layout does not overflow horizontally')
    await page.setViewportSize({ width: 1440, height: 1000 })

    const target = { target_workspace_id: workspaceId, target_task_id: first.id }
    assert.equal((await viewer.client.rpc('update_workspace_task', { ...target, task_status: 'done', task_title: 'Unauthorized' })).error?.code, '42501')
    assert.equal((await viewer.client.rpc('delete_workspace_task', target)).error?.code, '42501')
    assert.equal((await editor.client.rpc('delete_workspace_task', target)).error?.code, '42501')
    assert.equal((await outsider.client.rpc('update_workspace_task', { ...target, task_status: 'done' })).error?.code, '42501')
    assert.equal((await outsider.client.rpc('delete_workspace_task', target)).error?.code, '42501')
    await page.route('**/rest/v1/rpc/delete_workspace_task', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Delete denied', code: '42501' }) })
      } else await route.continue()
    })
    await details.getByRole('button', { name: 'Delete task', exact: true }).click()
    await details.getByRole('alert').filter({ hasText: 'Delete denied' }).waitFor()
    assert.equal(unwrap(await admin.from('tasks').select('id').eq('id', first.id)).length, 1)
    await page.unroute('**/rest/v1/rpc/delete_workspace_task')
    await details.getByRole('button', { name: 'Delete task', exact: true }).click()
    await details.waitFor({ state: 'detached' })
    await table.getByRole('button', { name: 'Renamed task', exact: true }).waitFor({ state: 'detached' })
    assert.equal(unwrap(await admin.from('tasks').select('id').eq('id', first.id)).length, 0)
    await page.reload()
    await table.getByRole('button', { name: second.title, exact: true }).waitFor()
    assert.equal(await table.getByRole('button', { name: 'Renamed task', exact: true }).count(), 0)
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})
