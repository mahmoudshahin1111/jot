import test from 'node:test'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { fixture, admin, unwrap } from './invitation-fixture.mjs'
import { runInvitationBrowserFlow } from './invitation-browser-flow.mjs'

test('Users count follows filtering and removal but not pagination', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('pagination-owner')
    const workspace = await f.workspace(owner)
    const role = await f.role('workspace.viewer')
    const members = []
    for (let index = 0; index < 12; index++) members.push(await f.user(`pagination-member-${index}`))
    unwrap(await admin.from('workspace_users').insert(members.map(member => ({
      workspace_id: workspace, user_id: member.id, role_id: role,
    }))))
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('dialog', dialog => dialog.accept())
    const counts = []
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/rpc/count_')) counts.push(request)
    })
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspace}/settings/users`)
    const sections = page.getByRole('navigation', { name: 'Users sections' })
    await sections.getByRole('button', { name: 'Users 13', exact: true }).waitFor()
    await sections.getByRole('button', { name: 'Invitations 0/10', exact: true }).waitFor()
    const invitationCounts = () => counts.filter(request => request.url().endsWith('/rpc/count_my_workspace_invitations')).length
    const userCounts = () => counts.filter(request => request.url().endsWith('/rpc/count_workspace_users')).length
    const initialInvitations = invitationCounts()
    await page.getByRole('textbox', { name: 'Filter users', exact: true }).fill('pagination-member')
    await sections.getByRole('button', { name: 'Users 12', exact: true }).waitFor()
    const initialUserCounts = userCounts()
    const list = page.getByLabel('Workspace users', { exact: true })
    await list.locator('li').nth(9).waitFor()
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    await list.locator('li').nth(11).waitFor()
    assert.equal(userCounts(), initialUserCounts, 'Pagination does not recount users')
    assert.equal(invitationCounts(), initialInvitations, 'User filtering does not recount invitations')
    const first = list.locator('li').first()
    const email = await first.locator('p').nth(1).innerText()
    await first.getByRole('button', { name: /^Remove / }).click()
    await sections.getByRole('button', { name: 'Users 11', exact: true }).waitFor()
    const removed = members.find(member => member.email === email)
    assert.ok(removed)
    assert.equal(unwrap(await admin.from('workspace_users').select('user_id')
      .eq('workspace_id', workspace).eq('user_id', removed.id)).length, 0)
  } finally {
    await browser.close()
    await f.cleanup()
  }
})

test('Users page enforces the invitation cap and completes email acceptance without losing another workspace', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const sender = await f.user('browser-sender')
    const recipient = await f.user('browser-recipient')
    const workspaceId = await f.workspace(sender)
    await f.workspace(recipient)
    const viewer = await f.role('workspace.viewer')
    for (let index = 0; index < 10; index++) await f.invite(sender, workspaceId, viewer, `${f.prefix}-pending-${index}@example.com`)
    await runInvitationBrowserFlow(browser, {
      email: sender.email, password: sender.password, recipientEmail: recipient.email, workspaceId,
    })
  } finally {
    await browser.close()
    await f.cleanup()
  }
})

test('sidebar hides unauthorized pages and empty groups, and responds to permission changes', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('navigation-owner')
    const member = await f.user('navigation-member')
    const workspaceId = await f.workspace(owner)
    const role = unwrap(await owner.client.rpc('create_workspace_role', { target_workspace_id: workspaceId, role_name: 'Navigation test role' }))
    const permissions = unwrap(await admin.from('permissions').select('id, key').in('key', ['tasks.read', 'roles.read']))
    const taskRead = permissions.find(permission => permission.key === 'tasks.read').id
    const roleRead = permissions.find(permission => permission.key === 'roles.read').id
    const save = async (next, previous) => unwrap(await owner.client.rpc('save_workspace_role_permissions', {
      target_workspace_id: workspaceId, target_role_id: role.id, permission_ids: next, expected_permission_ids: previous,
    }))
    await save([taskRead], [])
    unwrap(await admin.from('workspace_users').insert({ workspace_id: workspaceId, user_id: member.id, role_id: role.id }))
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/settings/users`)
    await page.waitForURL(url => url.pathname === '/login')
    await page.getByLabel('Email', { exact: true }).fill(member.email)
    await page.getByLabel('Password', { exact: true }).fill(member.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/settings/roles`)
    await page.waitForURL(`**/workspaces/${workspaceId}/dashboard`)
    const sidebar = page.getByRole('navigation', { name: 'Workspace navigation', exact: true })
    assert.equal(await sidebar.getByRole('link', { name: 'Roles and permissions', exact: true }).count(), 0)
    assert.equal(await sidebar.getByRole('link', { name: 'Users', exact: true }).count(), 0)
    assert.equal(await sidebar.getByRole('region', { name: 'Settings', exact: true }).count(), 0)
    assert.equal(await sidebar.getByRole('link', { name: 'Dashboard', exact: true }).count(), 1)
    assert.equal(await sidebar.getByRole('link', { name: 'Activity', exact: true }).count(), 1)
    await save([taskRead, roleRead], [taskRead])
    await sidebar.getByRole('link', { name: 'Roles and permissions', exact: true }).waitFor()
    await sidebar.getByRole('link', { name: 'Users', exact: true }).waitFor()
    await sidebar.getByRole('link', { name: 'Users', exact: true }).click()
    await page.getByRole('heading', { name: 'Users', level: 1, exact: true }).waitFor()
    await save([taskRead], [taskRead, roleRead])
    await page.waitForURL(`**/workspaces/${workspaceId}/dashboard`)
    await sidebar.getByRole('region', { name: 'Settings', exact: true }).waitFor({ state: 'detached' })
    assert.equal(await sidebar.getByRole('link', { name: 'Users', exact: true }).count(), 0)
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/settings/users`)
    await page.waitForURL(`**/workspaces/${workspaceId}/dashboard`)
    assert.deepEqual(unwrap(await admin.from('role_permissions').select('permission_id').eq('role_id', role.id)).map(row => row.permission_id), [taskRead])
    const replacement = unwrap(await owner.client.rpc('create_workspace_role', {
      target_workspace_id: workspaceId, role_name: 'Replacement navigation role',
    }))
    unwrap(await owner.client.rpc('save_workspace_role_permissions', {
      target_workspace_id: workspaceId, target_role_id: replacement.id,
      permission_ids: [taskRead, roleRead], expected_permission_ids: [],
    }))
    unwrap(await admin.from('workspace_users').update({ role_id: replacement.id })
      .eq('workspace_id', workspaceId).eq('user_id', member.id))
    await sidebar.getByRole('link', { name: 'Roles and permissions', exact: true }).waitFor()
    await sidebar.getByRole('link', { name: 'Users', exact: true }).click()
    await page.getByRole('heading', { name: 'Users', level: 1, exact: true }).waitFor()
    unwrap(await admin.from('workspace_users').delete().eq('workspace_id', workspaceId).eq('user_id', member.id))
    await page.waitForURL(url => url.pathname === '/workspaces')
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})
