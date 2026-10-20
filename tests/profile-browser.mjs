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
    if (credentials.grant_type === 'refresh_token') {
      return route.fulfill({
        json: {
          access_token: 'refreshed-browser-test-session',
          refresh_token: 'refreshed-browser-test-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          user: account,
        },
      })
    }
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
      let avatarCreates = 0
      let avatarCompletions = 0
      let avatarTransfers = 0
      let holdNextTransfer = false
      let transferStarted
      let markTransferStarted
      let releaseTransfer
      await page.route(`${authURL}/functions/v1/profile-avatar`, async route => {
        if (route.request().method() === 'OPTIONS') {
          return route.fulfill({
            headers: {
              'access-control-allow-origin': new URL(baseURL).origin,
              'access-control-allow-methods': 'POST, OPTIONS',
              'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
            },
          })
        }
        const body = route.request().postDataJSON()
        if (body.action === 'create') {
          avatarCreates++
          const path = `avatars/${user.id}/00000000-0000-4000-8000-${String(avatarCreates).padStart(12, '0')}.png`
          return route.fulfill({
            json: {
              path,
              signedUrl: `${authURL}/storage/v1/object/upload/sign/${path}?token=profile-test`,
            },
            headers: { 'access-control-allow-origin': new URL(baseURL).origin },
          })
        }
        avatarCompletions++
        return route.fulfill({
          json: { path: body.path },
          headers: { 'access-control-allow-origin': new URL(baseURL).origin },
        })
      })
      await page.route(`${authURL}/storage/v1/object/upload/sign/**`, async route => {
        if (route.request().method() === 'OPTIONS') {
          return route.fulfill({
            headers: {
              'access-control-allow-origin': new URL(baseURL).origin,
              'access-control-allow-methods': 'PUT, OPTIONS',
              'access-control-allow-headers': 'content-type',
            },
          })
        }
        avatarTransfers++
        if (holdNextTransfer) {
          holdNextTransfer = false
          markTransferStarted()
          await new Promise(resolve => { releaseTransfer = resolve })
          try {
            await route.fulfill({
              status: 200,
              headers: { 'access-control-allow-origin': new URL(baseURL).origin },
            })
          } catch {}
          return
        }
        await route.fulfill({
          status: avatarTransfers === 1 ? 503 : 200,
          headers: { 'access-control-allow-origin': new URL(baseURL).origin },
        })
      })
      const avatarInput = page.getByLabel('Choose a profile image')
      await avatarInput.setInputFiles({ name: 'avatar.gif', mimeType: 'image/gif', buffer: Buffer.from('invalid') })
      await page.getByRole('alert').filter({ hasText: 'Choose a JPEG, PNG, or WebP image.' }).waitFor()
      assert.equal(avatarCreates, 0)
      await avatarInput.setInputFiles({
        name: 'large.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
      })
      await page.getByRole('alert').filter({ hasText: 'no larger than 2 MB' }).waitFor()
      assert.equal(avatarCreates, 0)
      const largeDimensionPng = await page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 1025
        canvas.height = 1
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        return Array.from(new Uint8Array(await blob.arrayBuffer()))
      })
      await avatarInput.setInputFiles({
        name: 'wide.png',
        mimeType: 'image/png',
        buffer: Buffer.from(largeDimensionPng),
      })
      await page.getByRole('alert').filter({ hasText: 'no larger than 1024' }).waitFor()
      assert.equal(avatarCreates, 0)
      const validPng = await page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        return Array.from(new Uint8Array(await blob.arrayBuffer()))
      })
      const uploadFile = { name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(validPng) }
      await avatarInput.setInputFiles(uploadFile)
      await page.getByRole('alert').filter({ hasText: 'Image upload failed (503).' }).waitFor()
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Profile photo saved successfully.' }).waitFor()
      assert.equal(avatarCreates, 2)
      assert.equal(avatarTransfers, 2)
      assert.equal(avatarCompletions, 1)
      const savedAvatar = page.locator('main img')
      const savedAvatarUrl = await savedAvatar.getAttribute('src')
      assert.match(savedAvatarUrl, /00000000-0000-4000-8000-000000000002\.png/)
      await page.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: 'User menu' }).click()
      assert.equal(await page.getByRole('menu').locator('img').count(), 1)
      await page.keyboard.press('Escape')
      holdNextTransfer = true
      transferStarted = new Promise(resolve => { markTransferStarted = resolve })
      await avatarInput.setInputFiles(uploadFile)
      await transferStarted
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      releaseTransfer()
      assert.equal(avatarCompletions, 1)
      assert.equal(await savedAvatar.getAttribute('src'), savedAvatarUrl)
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
