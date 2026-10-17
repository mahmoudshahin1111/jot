import test from 'node:test'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { fixture, admin, unwrap } from './invitation-fixture.mjs'

const membersMessage = "You can't delete a role assigned to members. Move all members to another role before deleting it."

test('Roles actions follow independent permissions and update live', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('actions-owner')
    const member = await f.user('actions-member')
    const workspaceId = await f.workspace(owner)
    const create = async name => unwrap(await owner.client.rpc('create_workspace_role', {
      target_workspace_id: workspaceId, role_name: name,
    }))
    const assigned = await create('Action permissions')
    const target = await create('Editable target')
    const permissions = unwrap(await admin.from('permissions').select('id, key'))
    const ids = keys => keys.map(key => {
      const permission = permissions.find(item => item.key === key)
      assert.ok(permission, `Permission ${key} exists`)
      return permission.id
    })
    let previous = []
    const grant = async keys => {
      const next = ids(keys)
      unwrap(await owner.client.rpc('save_workspace_role_permissions', {
        target_workspace_id: workspaceId, target_role_id: assigned.id,
        permission_ids: next, expected_permission_ids: previous,
      }))
      previous = next
    }
    await grant(['roles.read'])
    unwrap(await admin.from('workspace_users').insert({ workspace_id: workspaceId, user_id: member.id, role_id: assigned.id }))
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(member.email)
    await page.getByLabel('Password', { exact: true }).fill(member.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/settings/roles`)
    await page.getByLabel('Workspace roles', { exact: true }).getByRole('button', { name: /^Editable target/ }).click()
    const createButton = page.getByRole('button', { name: 'Create role', exact: true })
    const duplicateButton = page.getByRole('button', { name: 'Duplicate role', exact: true })
    assert.equal(await createButton.count(), 0)
    assert.equal(await duplicateButton.count(), 0)
    assert.equal(await page.getByRole('checkbox').first().isDisabled(), true)
    const duplicate = () => member.client.rpc('duplicate_workspace_role', { target_workspace_id: workspaceId, target_role_id: target.id })
    assert.equal((await duplicate()).error?.code, '42501')

    await grant(['roles.read', 'roles.create'])
    await createButton.waitFor()
    assert.equal(await duplicateButton.count(), 0, 'Create does not grant duplicate')
    assert.equal((await duplicate()).error?.code, '42501')
    unwrap(await member.client.rpc('create_workspace_role', { target_workspace_id: workspaceId, role_name: 'Created by member' }))

    await grant(['roles.read', 'roles.duplicate'])
    await duplicateButton.waitFor()
    await createButton.waitFor({ state: 'detached' })
    assert.equal((await member.client.rpc('create_workspace_role', { target_workspace_id: workspaceId, role_name: 'Forbidden' })).error?.code, '42501')
    await duplicateButton.click()
    await page.getByText('Role duplicated without members.', { exact: true }).waitFor()
    assert.equal(unwrap(await admin.from('roles').select('id').eq('workspace_id', workspaceId).eq('name', 'Editable target (copy)')).length, 1)

    await grant(['roles.read', 'roles.update'])
    await duplicateButton.waitFor({ state: 'detached' })
    await page.getByRole('checkbox').first().waitFor()
    await page.waitForFunction(() => !document.querySelector('input[type="checkbox"]')?.disabled)
    await page.getByRole('checkbox').first().click()
    await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor()
    await grant(['roles.read'])
    await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor({ state: 'detached' })
    assert.equal(await page.getByRole('checkbox').first().isDisabled(), true)

    await grant(['tasks.read'])
    await page.waitForURL(`**/workspaces/${workspaceId}/dashboard`)
    assert.equal(await page.getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Roles and permissions', exact: true }).count(), 0)
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})

test('Roles list loads the next page when its wrapper scrolls to the bottom', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('scroll-owner')
    const workspaceId = await f.workspace(owner)
    for (let index = 0; index < 15; index++) {
      unwrap(await owner.client.rpc('create_workspace_role', {
        target_workspace_id: workspaceId, role_name: `Scroll role ${index}`,
      }))
    }
    const context = await browser.newContext()
    const page = await context.newPage()
    const counts = []
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/rpc/count_workspace_roles')) counts.push(request)
    })
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/settings/roles`)
    const roles = page.getByLabel('Workspace roles', { exact: true })
    const rows = roles.locator('li')
    await rows.nth(9).waitFor()
    await page.getByText('18 roles in this workspace', { exact: true }).waitFor()
    const initialCounts = counts.length
    assert.ok(initialCounts > 0)
    assert.equal(await rows.count(), 10, 'Only the first page is initially loaded')
    await roles.evaluate(element => { element.scrollTop = element.scrollHeight })
    await rows.nth(17).waitFor()
    assert.equal(await rows.count(), 18, 'Scrolling loads the remaining roles without clicking Load more')
    assert.equal(await roles.getByRole('button', { name: 'Load more roles', exact: true }).count(), 0)
    assert.equal(counts.length, initialCounts, 'Loading another roles page does not recount')
    await context.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})

test('Roles page deletes empty custom roles and explains why roles with members cannot be deleted', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('roles-owner')
    const member = await f.user('roles-member')
    const lateMember = await f.user('roles-late-member')
    const workspaceId = await f.workspace(owner)
    const createRole = async name => unwrap(await owner.client.rpc('create_workspace_role', { target_workspace_id: workspaceId, role_name: name }))
    const staffed = await createRole('Staffed role')
    const empty = await createRole('Empty role')
    const stale = await createRole('Stale role')
    unwrap(await admin.from('workspace_users').insert({ workspace_id: workspaceId, user_id: member.id, role_id: staffed.id }))

    const context = await browser.newContext()
    const page = await context.newPage()
    page.on('dialog', dialog => dialog.accept())
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspaceId}/settings/roles`)
    const roles = page.getByLabel('Workspace roles', { exact: true })
    const deleteButton = page.getByRole('button', { name: 'Delete role', exact: true })

    await roles.getByRole('button', { name: /^Owner/ }).click()
    assert.equal(await deleteButton.isDisabled(), true, 'System roles cannot be deleted')
    await page.getByLabel('Delete role unavailable. System roles cannot be deleted.', { exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await page.getByRole('tooltip').filter({ hasText: 'System roles cannot be deleted.' }).waitFor()

    await roles.getByRole('button', { name: /^Staffed role/ }).click()
    await page.getByRole('heading', { name: 'Staffed role', level: 2, exact: true }).waitFor()
    assert.equal(await deleteButton.isDisabled(), true, 'Roles with members cannot be deleted')
    await page.getByLabel(`Delete role unavailable. ${membersMessage}`, { exact: true }).hover()
    await page.getByRole('tooltip').filter({ hasText: membersMessage }).waitFor()

    await roles.getByRole('button', { name: /^Empty role/ }).click()
    await page.getByRole('heading', { name: 'Empty role', level: 2, exact: true }).waitFor()
    assert.equal(await deleteButton.isEnabled(), true, 'Empty custom roles can be deleted')
    await deleteButton.click()
    await page.getByText('Role deleted.', { exact: true }).waitFor()
    await roles.getByRole('button', { name: /^Empty role/ }).waitFor({ state: 'detached' })
    assert.equal(unwrap(await admin.from('roles').select('id').eq('id', empty.id)).length, 0)

    await roles.getByRole('button', { name: /^Stale role/ }).click()
    await page.getByRole('heading', { name: 'Stale role', level: 2, exact: true }).waitFor()
    unwrap(await admin.from('workspace_users').insert({ workspace_id: workspaceId, user_id: lateMember.id, role_id: stale.id }))
    assert.equal(await deleteButton.isEnabled(), true, 'The page still shows the stale empty member count')
    await deleteButton.click()
    await page.getByRole('alert').filter({ hasText: membersMessage }).waitFor()
    await page.getByRole('tab', { name: 'Members 1', exact: true }).waitFor()
    assert.equal(await deleteButton.isDisabled(), true, 'A stale member count is refreshed after the server rejects deletion')
    assert.equal(unwrap(await admin.from('roles').select('id').in('id', [staffed.id, stale.id])).length, 2)
    await context.close()

    const permissionIds = unwrap(await admin.from('permissions').select('id').in('key', ['roles.read', 'roles.update']))
      .map(permission => permission.id)
    unwrap(await owner.client.rpc('save_workspace_role_permissions', {
      target_workspace_id: workspaceId, target_role_id: staffed.id,
      permission_ids: permissionIds, expected_permission_ids: [],
    }))
    const memberContext = await browser.newContext()
    const memberPage = await memberContext.newPage()
    await memberPage.goto('http://localhost:5173/login')
    await memberPage.getByLabel('Email', { exact: true }).fill(member.email)
    await memberPage.getByLabel('Password', { exact: true }).fill(member.password)
    await memberPage.getByRole('button', { name: 'Sign in', exact: true }).click()
    await memberPage.waitForURL(url => url.pathname === '/workspaces')
    await memberPage.goto(`http://localhost:5173/workspaces/${workspaceId}/settings/roles`)
    await memberPage.getByLabel('Workspace roles', { exact: true }).getByRole('button', { name: /^Staffed role/ }).click()
    assert.equal(await memberPage.getByRole('button', { name: 'Delete role', exact: true }).isDisabled(), true)
    await memberPage.getByLabel('Delete role unavailable. You need roles.delete permission to delete roles.', { exact: true }).hover()
    await memberPage.getByRole('tooltip').filter({ hasText: 'You need roles.delete permission to delete roles.' }).waitFor()
    const ownRoleMessage = 'You cannot update a role assigned to you. Only the workspace owner can do this.'
    const checkbox = memberPage.getByRole('checkbox').first()
    assert.equal(await checkbox.isDisabled(), true, 'A non-owner cannot edit their own role')
    await memberPage.getByLabel(/Allow .*: editing unavailable/).first().focus()
    await memberPage.keyboard.press('Shift+Tab')
    await memberPage.keyboard.press('Tab')
    await memberPage.getByRole('tooltip').filter({ hasText: ownRoleMessage }).waitFor()
    await memberContext.close()
  } finally {
    await browser.close()
    await f.cleanup()
  }
})
