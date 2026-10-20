import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { imageDimensions } from '../_shared/avatar-image.ts'

const bucket = 'avatars'
const maxBytes = 2 * 1024 * 1024
const maxDimension = 1024
const mimeExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
const cors = {
  'Access-Control-Allow-Origin': new URL(appUrl).origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

Deno.serve(async request => {
  const respond = (status: number, body: object) => Response.json(body, { status, headers: cors })
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' })

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return respond(401, { error: 'Sign in to upload a profile image.' })
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceRoleKey) {
    console.error('Profile avatar function is missing Supabase configuration.')
    return respond(500, { error: 'Profile image uploads are not configured.' })
  }
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await caller.auth.getUser(authorization.slice(7))
  if (authError || !authData.user) return respond(401, { error: 'Your session expired. Sign in again.' })
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let input: unknown
  try {
    input = await request.json()
  } catch {
    return respond(400, { error: 'Invalid profile image request.' })
  }
  if (typeof input !== 'object' || input === null || !('action' in input) || typeof input.action !== 'string') {
    return respond(400, { error: 'Invalid profile image request.' })
  }

  if (input.action === 'create') {
    if (!('contentType' in input) || typeof input.contentType !== 'string'
      || !('size' in input) || typeof input.size !== 'number' || !Number.isInteger(input.size)
      || input.size < 1 || input.size > maxBytes || !Object.hasOwn(mimeExtensions, input.contentType)) {
      return respond(400, { error: 'Choose a JPEG, PNG, or WebP image no larger than 2 MB.' })
    }
    const extension = mimeExtensions[input.contentType]
    const path = `${authData.user.id}/${crypto.randomUUID()}.${extension}`
    const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path, { upsert: false })
    if (error || !data) {
      console.error('Could not create a signed profile image upload URL', { userId: authData.user.id, error: error?.message })
      return respond(500, { error: 'Unable to start the profile image upload. Please retry.' })
    }
    return respond(200, { path: `${bucket}/${path}`, signedUrl: data.signedUrl })
  }

  if (input.action !== 'complete' || !('path' in input) || typeof input.path !== 'string') {
    return respond(400, { error: 'Invalid profile image request.' })
  }
  const userPrefix = `${authData.user.id}/`
  const path = input.path.startsWith(`${bucket}/`) ? input.path.slice(bucket.length + 1) : ''
  const filename = path.startsWith(userPrefix) ? path.slice(userPrefix.length) : ''
  const extension = filename.match(/^[0-9a-f-]{36}\.(jpg|png|webp)$/i)?.[1]
  const expectedType = extension === 'jpg' ? 'image/jpeg' : extension ? `image/${extension}` : null
  if (!expectedType) return respond(400, { error: 'The upload path is not valid for your account.' })

  const { data: file, error: downloadError } = await admin.storage.from(bucket).download(path)
  if (downloadError || !file) return respond(400, { error: 'The uploaded image could not be found.' })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const dimensions = imageDimensions(expectedType, bytes)
  if (file.size < 1 || file.size > maxBytes || !dimensions
    || dimensions.width < 1 || dimensions.height < 1
    || dimensions.width > maxDimension || dimensions.height > maxDimension) {
    const { error: cleanupError } = await admin.storage.from(bucket).remove([path])
    if (cleanupError) console.error('Could not remove an invalid profile image upload', { userId: authData.user.id, error: cleanupError.message })
    return respond(400, { error: 'The uploaded image is invalid or exceeds 2 MB or 1024 × 1024 pixels.' })
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(authData.user.id, {
    user_metadata: { ...authData.user.user_metadata, avatar_path: `${bucket}/${path}` },
  })
  if (updateError) {
    const { error: cleanupError } = await admin.storage.from(bucket).remove([path])
    console.error('Could not save the profile image reference', {
      userId: authData.user.id,
      error: updateError.message,
      cleanupFailed: Boolean(cleanupError),
    })
    return respond(500, { error: 'The image uploaded, but your profile could not be updated. Please retry.' })
  }
  return respond(200, { path: `${bucket}/${path}` })
})
