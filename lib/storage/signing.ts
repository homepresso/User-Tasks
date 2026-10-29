import { createHmac, timingSafeEqual } from 'node:crypto'
import { configuredAppUrl, getBootstrapConfig } from '@/lib/config/bootstrap'
import { encodeKeyPath } from '@/lib/providers/storage/options'

/**
 * App-signed /files URLs: `/files/<bucket>/<key>?expires=<unix s>&signature=<hmac>`.
 * The local provider's signedUrl() (it has no store of its own to sign with)
 * and the /files route's check for private buckets. The key is derived from
 * ENCRYPTION_KEY (else the processor secret); without either, signing is
 * unavailable and signed URLs are refused.
 */

const MAX_TTL_SECONDS = 7 * 24 * 3600

function signingKey(): Buffer | null {
  const cfg = getBootstrapConfig()
  const secret = cfg.encryptionKey || cfg.processorSecret || cfg.jwtSecret
  if (!secret) return null
  return createHmac('sha256', 'usertasks-files-v1').update(secret).digest()
}

function mac(key: Buffer, bucket: string, objectKey: string, expires: number): string {
  return createHmac('sha256', key).update(`${bucket}\n${objectKey}\n${expires}`).digest('base64url')
}

export function appSignedFilesUrl(bucket: string, objectKey: string, ttlSeconds: number, now = Date.now()): string {
  const key = signingKey()
  if (!key) throw new Error('Signed file URLs need ENCRYPTION_KEY (or WORKFLOW_PROCESSOR_SECRET) to be set')
  const ttl = Math.max(1, Math.min(Math.floor(ttlSeconds), MAX_TTL_SECONDS))
  const expires = Math.floor(now / 1000) + ttl
  const base = (configuredAppUrl() ?? '').trim().replace(/\/+$/, '')
  return `${base}/files/${bucket}/${encodeKeyPath(objectKey)}?expires=${expires}&signature=${mac(key, bucket, objectKey, expires)}`
}

/** Valid, unexpired signature for this object. */
export function verifyFilesSignature(bucket: string, objectKey: string, expires: string | null, signature: string | null, now = Date.now()): boolean {
  if (!expires || !signature || !/^\d{1,12}$/.test(expires)) return false
  const exp = Number(expires)
  if (exp * 1000 < now) return false
  const key = signingKey()
  if (!key) return false
  const expected = Buffer.from(mac(key, bucket, objectKey, exp))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/**
 * `expires=…&signature=…` for an object of `bucket` (same key and MAC as
 * appSignedFilesUrl), for routes that serve a bucket themselves
 * (/attachments/<id>); null when signing is unavailable.
 */
export function signedObjectQuery(bucket: string, objectKey: string, ttlSeconds: number, now = Date.now()): string | null {
  const key = signingKey()
  if (!key) return null
  const ttl = Math.max(1, Math.min(Math.floor(ttlSeconds), MAX_TTL_SECONDS))
  const expires = Math.floor(now / 1000) + ttl
  return `expires=${expires}&signature=${mac(key, bucket, objectKey, expires)}`
}
