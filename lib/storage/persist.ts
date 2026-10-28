import type { ProviderId } from '@/lib/config/schema'
import { formatStorageRef, parseOwnStorageUrl, resolveStorageUrl, toStorageRef } from './refs'

/**
 * What writers persist for a stored object.
 *
 * With the default supabase provider nothing changes: the database keeps the
 * Supabase public URLs it always held (production runs on it, and existing
 * API / MCP clients read those values). With any other provider writers
 * persist `storage://` references, which survive later provider switches;
 * the storage migration (lib/storage/migrate.ts) rewrites legacy URLs when
 * an install moves off Supabase. Readers resolve either form
 * (resolveStorageUrl), so both coexist.
 */

export function writesStorageRefs(providerId: ProviderId<'storage'> | undefined): boolean {
  return (providerId ?? 'supabase') !== 'supabase'
}

/** Normalise an own-storage value for persisting (other values are returned unchanged). */
export function persistableStorageValue<T>(value: T, providerId: ProviderId<'storage'> | undefined): T | string {
  if (typeof value !== 'string' || !parseOwnStorageUrl(value)) return value
  if (writesStorageRefs(providerId)) return toStorageRef(value)
  // Supabase: store the public URL, as before (a reference sent by a client is expanded).
  return resolveStorageUrl(value, { absolute: true })
}

/** Extra fields for a file object (`{ name, url, path, size }`): `ref` when references are written. */
export function fileRefFields(bucket: string, key: string, providerId: ProviderId<'storage'> | undefined): { ref?: string } {
  return writesStorageRefs(providerId) ? { ref: formatStorageRef(bucket, key) } : {}
}
