import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { fixture, admin, unwrap } from './invitation-fixture.mjs'

test('Activity shows three columns, details from every cell, bounded pages, search, and retry', async () => {
  const module = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
  const { chromium } = await import(module)
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const f = await fixture()
  try {
    const owner = await f.user('activity-browser-owner')
    const workspace = await f.workspace(owner)
    const eventTypes = [
      'workspace.created', 'task.created', 'task.updated', 'task.deleted',
      'role.created', 'role.updated', 'role.deleted', 'role.permissions.updated',
      'member.added', 'member.role_changed', 'member.removed',
      'invitation.created', 'invitation.canceled', 'invitation.accepted',
    ]
    unwrap(await admin.from('workspace_activity_events').delete().eq('workspace_id', workspace))
    unwrap(await admin.from('workspace_activity_events').insert(Array.from({ length: 45 }, (_, index) => ({
      workspace_id: workspace, event_type: index === 44 ? 'task.updated' : eventTypes[index % eventTypes.length], actor_name: 'Amira Hassan',
      description: `Updated task ${index}`, created_at: new Date(Date.UTC(2026, 9, 16, 12, index)).toISOString(),
    }))))
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const requests = []
    page.on('request', request => {
      if (request.url().includes('/rest/v1/')) requests.push(request)
    })
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email', { exact: true }).fill(owner.email)
    await page.getByLabel('Password', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/workspaces')
    await page.goto(`http://localhost:5173/workspaces/${workspace}/activity`)
    const table = page.getByRole('table', { name: 'Workspace activity' })
    const previous = page.getByRole('button', { name: 'Previous', exact: true })
    const next = page.getByRole('button', { name: 'Next', exact: true })
    await page.getByText('Showing 1 to 20 of 45 events', { exact: true }).waitFor()
    const countCalls = () => requests.filter(request =>
      request.method() === 'POST' && request.url().endsWith('/rpc/count_workspace_activity_events'))
    const initialCounts = countCalls().length
    assert.ok(initialCounts > 0)
    async function checkBadges() {
      const badges = await table.locator('td:first-child > span').evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element)
        const cell = element.parentElement.getBoundingClientRect()
        const badge = element.getBoundingClientRect()
        return { label: element.textContent, color: style.color, whitespace: style.whiteSpace, fits: badge.right <= cell.right }
      }))
      const colors = new Map(badges.map(badge => [badge.label, badge.color]))
      assert.equal(colors.size, eventTypes.length)
      assert.equal(new Set(colors.values()).size, eventTypes.length, 'Every event type has a different color')
      assert.ok(badges.every(badge => badge.whitespace === 'nowrap' && badge.fits), 'All badges fit without wrapping')
      assert.equal(await table.locator('col').first().evaluate(element => element.getBoundingClientRect().width), 208)
    }
    await checkBadges()
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await checkBadges()
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    assert.equal(await table.getByRole('columnheader').count(), 0)
    assert.equal(await table.getByRole('row').count(), 20)
    assert.equal(await previous.isDisabled(), true)
    const row = table.getByRole('row').first()
    assert.equal(await row.getByRole('cell').count(), 3)
    assert.match(await row.innerText(), /Task updated[\s\S]*Updated task 44[\s\S]*by Amira Hassan/)
    assert.ok(await row.locator('time').getAttribute('datetime'))
    for (let cell = 0; cell < 3; cell++) {
      await row.getByRole('cell').nth(cell).click()
      const details = page.getByRole('region', { name: 'Event details' })
      await details.waitFor()
      assert.match(await details.innerText(), /task.updated[\s\S]*Updated task 44[\s\S]*Amira Hassan/)
      await page.getByRole('button', { name: 'Close event details' }).click()
    }
    await row.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('region', { name: 'Event details' }).waitFor()
    await next.click()
    await page.getByText('Showing 21 to 40 of 45 events', { exact: true }).waitFor()
    assert.equal(countCalls().length, initialCounts, 'Next/Previous never recount')
    assert.equal(await page.getByRole('region', { name: 'Event details' }).count(), 0)
    await next.click()
    await page.getByText('Showing 41 to 45 of 45 events', { exact: true }).waitFor()
    assert.equal(await next.isDisabled(), true)
    assert.equal(await table.getByRole('row').count(), 5)
    await previous.click()
    await page.getByText('Showing 21 to 40 of 45 events', { exact: true }).waitFor()
    const search = page.getByRole('searchbox', { name: 'Search activity' })
    await search.fill('Updated task 44')
    await page.getByText('Showing 1 to 1 of 1 events', { exact: true }).waitFor()
    assert.equal(countCalls().at(-1).postDataJSON().search_term, 'Updated task 44')
    assert.equal(await previous.isDisabled(), true)
    assert.equal(await next.isDisabled(), true)
    await search.fill('nothing matches')
    await page.getByText('No activity matches your search.', { exact: true }).waitFor()
    await page.getByText('Showing 0 to 0 of 0 events', { exact: true }).waitFor()
    await page.route('**/rest/v1/rpc/list_workspace_activity_events', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Activity denied', code: '42501' }) })
      } else await route.continue()
    })
    await search.fill('')
    await page.getByRole('alert').filter({ hasText: 'Activity denied' }).waitFor()
    assert.equal(await next.isDisabled(), true)
    await page.unroute('**/rest/v1/rpc/list_workspace_activity_events')
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.getByText('Showing 1 to 20 of 45 events', { exact: true }).waitFor()
    await page.route('**/rest/v1/rpc/count_workspace_activity_events', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Count unavailable' }) })
      } else await route.continue()
    })
    await search.fill('Updated task 44')
    await page.getByRole('alert').filter({ hasText: 'Count unavailable' }).waitFor()
    await page.getByText('Showing 1 to 1 events', { exact: true }).waitFor()
    assert.equal(await table.getByRole('row').count(), 1, 'Count failure does not hide events')
    await page.unroute('**/rest/v1/rpc/count_workspace_activity_events')
    await page.getByRole('button', { name: 'Retry count', exact: true }).click()
    await page.getByText('Showing 1 to 1 of 1 events', { exact: true }).waitFor()
    await search.fill('')
    await page.getByText('Showing 1 to 20 of 45 events', { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await table.getByRole('row').first().press('Space')
    await page.getByRole('region', { name: 'Event details' }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Table scroll is contained on mobile')
    assert.ok(requests.every(request => new URL(request.url()).pathname.startsWith('/rest/v1/rpc/')), 'No direct table access')
    const calls = requests.filter(request => request.url().endsWith('/rpc/list_workspace_activity_events')).map(request => request.postDataJSON())
    assert.ok(calls.every(args => args.page_size === 20))
    assert.ok(calls.some(args => args.before_id), 'Next page uses a cursor')
  } finally {
    await browser.close()
    await f.cleanup()
  }
})
