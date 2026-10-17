import test from 'node:test'
import assert from 'node:assert/strict'
import { getAvatarColor, getAvatarInitials } from '../src/lib/avatar.ts'
import { profileSchema } from '../src/lib/profile-schema.ts'

test('avatar colors cover every Latin letter regardless of case', () => {
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const expected = letter <= 'E' ? 'bg-orange-600' : 'bg-green-700'
    assert.equal(getAvatarColor(`${letter}da`), expected)
    assert.equal(getAvatarColor(`${letter.toLowerCase()}da`), expected)
  }
  assert.equal(getAvatarColor('  Alice  '), 'bg-orange-600')
})

test('empty, numeric, non-Latin, and punctuation usernames use the fallback color', () => {
  for (const username of ['', ' ', '123', 'محمد', '李', 'Émile', 'ß', '_user', '😀']) {
    assert.equal(getAvatarColor(username), 'bg-slate-600')
  }
})

test('avatar initials handle short and Unicode usernames', () => {
  assert.equal(getAvatarInitials('alice'), 'AL')
  assert.equal(getAvatarInitials(' f '), 'F')
  assert.equal(getAvatarInitials(''), '?')
  assert.equal(getAvatarInitials('李'), '李')
  assert.equal(getAvatarInitials('😀a'), '😀A')
})

test('password and confirmation are required and must match', () => {
  for (const values of [
    { password: '', confirmPassword: '' },
    { password: '', confirmPassword: 'secret123' },
    { password: 'secret123', confirmPassword: '' },
    { password: 'secret123', confirmPassword: 'different' },
    { password: 'short', confirmPassword: 'short' },
  ]) {
    assert.equal(profileSchema.safeParse(values).success, false)
  }
  const mismatch = profileSchema.safeParse({ password: 'secret123', confirmPassword: 'different' })
  assert.ok(mismatch.error.issues.some(issue => issue.path[0] === 'confirmPassword' && issue.message === 'Passwords do not match.'))
  assert.equal(profileSchema.safeParse({ password: 'secret123', confirmPassword: 'secret123' }).success, true)
})
