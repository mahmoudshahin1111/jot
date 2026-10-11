import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const status = JSON.parse(execFileSync(process.execPath, ['node_modules\\supabase\\dist\\supabase.js', 'status', '--output', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}))
assert.equal(status.API_URL, 'http://127.0.0.1:54321', 'Tests must use local Supabase only')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
export const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options)
export const anonymous = () => createClient(status.API_URL, status.ANON_KEY, options)
export const unwrap = ({ data, error }) => { assert.equal(error, null, error?.message); return data }

export async function fixture() {
  const users = []
  const workspaces = []
  const prefix = `invitation-test-${randomUUID()}`
  const password = randomUUID()
  return {
    prefix,
    async user(label, confirmed = true) {
      const email = `${prefix}-${label}@example.com`
      const { user } = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: confirmed }))
      users.push(user.id)
      const client = anonymous()
      if (confirmed) unwrap(await client.auth.signInWithPassword({ email, password }))
      return { id: user.id, email, password, client }
    },
    trackUser(id) { users.push(id) },
    async workspace(user) {
      const id = unwrap(await user.client.rpc('create_workspace', { workspace_name: prefix }))
      assert.equal(typeof id, 'string')
      workspaces.push(id)
      return id
    },
    async role(key) {
      return unwrap(await admin.from('roles').select('id').eq('key', key).eq('is_system', true).single()).id
    },
    async invite(sender, workspace, role, email) {
      return unwrap(await sender.client.rpc('create_workspace_invitation', {
        target_workspace_id: workspace, target_role_id: role, invited_email: email,
      }))
    },
    async deliver(id) {
      unwrap(await admin.from('workspace_invitations').update({ delivered_at: new Date().toISOString() }).eq('id', id))
    },
    async cleanup() {
      for (const id of workspaces) unwrap(await admin.from('workspaces').delete().eq('id', id))
      for (const id of users) unwrap(await admin.auth.admin.deleteUser(id))
      const response = await fetch('http://127.0.0.1:54324/api/v1/messages')
      assert.equal(response.ok, true)
      const mailbox = await response.json()
      for (const message of mailbox.messages ?? []) {
        if (message.To.some(recipient => recipient.Address.startsWith(prefix))) {
          const deleted = await fetch(`http://127.0.0.1:54324/api/v1/messages`, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [message.ID] }),
          })
          assert.equal(deleted.ok, true, 'Only fixture email messages should be removed')
        }
      }
    },
  }
}
