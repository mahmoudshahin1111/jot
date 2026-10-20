import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
const { chromium } = await import(module)
const baseURL = 'http://localhost:5173'
const authURL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated', role: 'authenticated', email: 'alice@example.com',
  user_metadata: { username: 'alice', full_name: 'Alice Example' },
  app_metadata: {}, created_at: '2026-01-01T00:00:00Z',
}

async function launch() {
  return chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  })
}

async function signIn(context, account = user) {
  await context.addInitScript(({ account, authURL }) => {
    const key = `sb-${new URL(authURL).hostname.split('.')[0]}-auth-token`
    if (!sessionStorage.getItem('profile-test-initialized')) {
      localStorage.setItem(key, JSON.stringify({
        access_token: 'browser-test-session',
        refresh_token: 'browser-test-refresh',
        token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: account,
      }))
      sessionStorage.setItem('profile-test-initialized', 'true')
    }
  }, { account, authURL })
  await context.route(`${authURL}/auth/v1/user`, route => route.fulfill({ json: account }))
  await context.route(`${authURL}/rest/v1/rpc/list_my_workspaces`, route => route.fulfill({
    json: [{ id: '00000000-0000-4000-8000-000000000002', name: 'Test workspace', created_at: '2026-01-01T00:00:00Z' }],
  }))
  await context.route(`${authURL}/rest/v1/rpc/get_workspace_access`, route => route.fulfill({
    json: {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Test workspace',
      role_id: '00000000-0000-4000-8000-000000000003',
      is_owner: false,
      permissions: ['tasks.read'],
    },
  }))
  await context.route(`${authURL}/rest/v1/rpc/get_workspace_role`, route => route.fulfill({
    json: {
      id: '00000000-0000-4000-8000-000000000003',
      key: 'admin',
      name: 'Admin',
      is_system: true,
      member_count: 1,
      permission_ids: [],
    },
  }))
  await context.route(`${authURL}/auth/v1/token*`, async route => {
    const credentials = route.request().postDataJSON()
    if (credentials.password !== 'current-password') {
      return route.fulfill({ status: 400, json: { msg: 'Invalid login credentials.', error: 'invalid_grant' } })
    }
    return route.fulfill({
      json: {
        access_token: 'verified-browser-test-session',
        refresh_token: 'verified-browser-test-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      },
    })
  })
}

test('unauthenticated visitors cannot access the profile form', async () => {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.goto(`${baseURL}/profile`)
    await page.waitForURL('**/login')
    assert.equal(await page.getByRole('button', { name: 'Update password' }).count(), 0)
  } finally { await browser.close() }
})

for (const width of [1280, 375, 320]) {
  test(`profile validation, feedback, menu navigation and logout at ${width}px`, async () => {
    const browser = await launch()
    try {
      const context = await browser.newContext({ viewport: { width, height: 800 } })
      await signIn(context)
      const page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.goto(`${baseURL}/workspaces`)
      await page.getByRole('button', { name: 'User menu' }).click()
      const menu = page.getByRole('menu')
      await menu.getByText('Alice Example', { exact: true }).waitFor()
      assert.equal(await menu.getByText('AL', { exact: true }).count(), 1)
      const bounds = await menu.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
      await page.getByRole('menuitem', { name: 'Profile', exact: true }).click()
      await page.waitForURL('**/profile')
      await page.getByRole('heading', { name: 'Change password' }).waitFor()
      let updates = 0
      const updateBodies = []
      let updateError = false
      await page.route(`${authURL}/auth/v1/user`, async route => {
        if (route.request().method() !== 'PUT') return route.fallback()
        updates++
        updateBodies.push(route.request().postDataJSON())
        await route.fulfill(updateError
          ? { status: 422, json: { msg: 'Password update rejected.', code: 'weak_password' } }
          : { json: user })
      })
      const currentPassword = page.getByLabel('Current password', { exact: true })
      const password = page.getByLabel('New password', { exact: true })
      const confirmation = page.getByLabel('Confirm new password', { exact: true })
      const save = page.getByRole('button', { name: 'Update password', exact: true })
      await save.click()
      await page.getByText('Enter your current password.', { exact: true }).waitFor()
      await page.getByText('Password must be at least 8 characters.', { exact: true }).waitFor()
      await page.getByText('Confirm your new password.', { exact: true }).waitFor()
      await currentPassword.fill('current-password')
      await password.fill('new-password-123')
      await confirmation.fill('different-password')
      await save.click()
      await page.getByText('Passwords do not match.', { exact: true }).waitFor()
      assert.equal(updates, 0)
      await confirmation.fill('new-password-123')
      await currentPassword.fill('wrong-password')
      await save.click()
      await page.getByRole('alert').filter({ hasText: 'Invalid login credentials.' }).waitFor()
      assert.equal(updates, 0)
      await currentPassword.fill('current-password')
      await page.getByLabel('Show passwords').check()
      assert.equal(await password.getAttribute('type'), 'text')
      await confirmation.fill('new-password-123')
      await save.click()
      await page.getByRole('status').filter({ hasText: 'Password updated successfully.' }).waitFor()
      assert.equal(await currentPassword.inputValue(), '')
      assert.equal(await password.inputValue(), '')
      assert.equal(await confirmation.inputValue(), '')
      updateError = true
      await currentPassword.fill('current-password')
      await password.fill('new-password-123')
      await confirmation.fill('new-password-123')
      await save.click()
      await page.getByRole('alert').filter({ hasText: 'Password update rejected.' }).waitFor()
      assert.equal(updates, 2)
      assert.ok(updateBodies.every(body => body.password === 'new-password-123' && !('confirmPassword' in body)))
      assert.equal(await page.getByText('Password updated successfully.', { exact: true }).count(), 0)
      await currentPassword.fill('cancel-current')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.equal(await currentPassword.inputValue(), '')
      assert.equal(await password.inputValue(), '')
      await page.getByRole('button', { name: 'User menu' }).focus()
      await page.keyboard.press('Enter')
      await menu.waitFor()
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('button', { name: 'User menu' }).evaluate(element => element === document.activeElement), true)
      let signOuts = 0
      await page.route(`${authURL}/auth/v1/logout*`, async route => {
        signOuts++
        await route.fulfill({ status: 204 })
      })
      await page.getByRole('button', { name: 'User menu' }).click()
      await page.getByRole('menuitem', { name: 'Log out', exact: true }).click()
      await page.waitForURL('**/login')
      assert.equal(signOuts, 1)
      await page.goto(`${baseURL}/profile`)
      await page.waitForURL('**/login')
      assert.deepEqual(pageErrors, [])
    } finally { await browser.close() }
  })
}
