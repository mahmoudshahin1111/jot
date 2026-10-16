import test from 'node:test'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { fixture, admin, unwrap } from './invitation-fixture.mjs'

const membersMessage = "You can't delete a role assigned to members. Move all members to another role before deleting it."

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
