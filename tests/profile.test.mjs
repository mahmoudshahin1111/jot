import test from 'node:test'
import assert from 'node:assert/strict'
import { getAvatarColor, getAvatarInitials, getUserAvatarPath } from '../src/lib/avatar.ts'
import { profileSchema } from '../src/lib/profile-schema.ts'
import { imageDimensions } from '../supabase/functions/_shared/avatar-image.ts'

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

test('saved avatar paths are restricted to the signed-in user and supported image extensions', () => {
  const userId = '00000000-0000-4000-8000-000000000001'
  const filename = '00000000-0000-4000-8000-000000000002.webp'
  assert.equal(getUserAvatarPath(`avatars/${userId}/${filename}`, userId), `avatars/${userId}/${filename}`)
  assert.equal(getUserAvatarPath(`avatars/00000000-0000-4000-8000-000000000003/${filename}`, userId), null)
  assert.equal(getUserAvatarPath(`avatars/${userId}/avatar.svg`, userId), null)
  assert.equal(getUserAvatarPath(null, userId), null)
})

test('server image header validation reads PNG, JPEG, and WebP dimensions', () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  png.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(png.buffer).setUint32(16, 1024)
  new DataView(png.buffer).setUint32(20, 768)
  assert.deepEqual(imageDimensions('image/png', png), { width: 1024, height: 768 })
  assert.equal(imageDimensions('image/png', new Uint8Array(24)), null)

  const jpeg = new Uint8Array(21)
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08])
  new DataView(jpeg.buffer).setUint16(7, 480)
  new DataView(jpeg.buffer).setUint16(9, 640)
  assert.deepEqual(imageDimensions('image/jpeg', jpeg), { width: 640, height: 480 })

  const webp = new Uint8Array(30)
  webp.set([0x52, 0x49, 0x46, 0x46])
  webp.set([0x57, 0x45, 0x42, 0x50], 8)
  webp.set([0x56, 0x50, 0x38, 0x58], 12)
  new DataView(webp.buffer).setUint32(16, 10, true)
  webp[24] = 9
  webp[27] = 19
  assert.deepEqual(imageDimensions('image/webp', webp), { width: 10, height: 20 })
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
