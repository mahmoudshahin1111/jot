import test from 'node:test'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { fixture, admin, unwrap } from './invitation-fixture.mjs'
import { runInvitationBrowserFlow } from './invitation-browser-flow.mjs'

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
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})
