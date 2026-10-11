import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { fixture } from './invitation-fixture.mjs'
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
