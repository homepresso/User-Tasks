import { configuredAppUrl } from '@/lib/config/bootstrap'
import { encodeKeyPath, publicBaseFor, type StorageOptions } from './options'

/**
 * publicUrl() for providers other than supabase: the configured public base
 * (S3 / CDN) when set, else the app's /files route on APP_URL (relative when
 * APP_URL is not configured).
 */
export function providerPublicUrl(bucket: string, key: string, options: StorageOptions): string {
  const base = publicBaseFor(bucket, options)
  if (base) return `${base}/${encodeKeyPath(key)}`
  const app = (configuredAppUrl() ?? '').trim().replace(/\/+$/, '')
  return `${app}/files/${bucket}/${encodeKeyPath(key)}`
}
