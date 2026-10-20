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

test('current password, password requirements, and confirmation are enforced', () => {
  for (const values of [
    { currentPassword: '', password: '', confirmPassword: '' },
    { currentPassword: 'current', password: '', confirmPassword: 'secret1234' },
    { currentPassword: 'current', password: '12345678', confirmPassword: '12345678' },
    { currentPassword: 'current', password: 'abcdefgh', confirmPassword: 'abcdefgh' },
    { currentPassword: 'current', password: 'short1', confirmPassword: 'short1' },
    { currentPassword: 'current', password: 'a123456', confirmPassword: 'a123456' },
    { currentPassword: 'current', password: 'secret1234', confirmPassword: '' },
    { currentPassword: 'current', password: 'secret1234', confirmPassword: 'different123' },
  ]) {
    assert.equal(profileSchema.safeParse(values).success, false)
  }
  const mismatch = profileSchema.safeParse({
    currentPassword: 'current', password: 'secret1234', confirmPassword: 'different123',
  })
  assert.ok(mismatch.error.issues.some(issue => issue.path[0] === 'confirmPassword' && issue.message === 'Passwords do not match.'))
  assert.equal(profileSchema.safeParse({
    currentPassword: 'current', password: 'a1234567', confirmPassword: 'a1234567',
  }).success, true)
})
