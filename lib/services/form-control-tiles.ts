/**
 * Map tiles for custom form controls (the `tile` host service): OpenStreetMap
 * raster tiles fetched by the UserTasks server and handed to the control
 * through the bridge.
 *
 * Why a server hop: a control frame is sandboxed (opaque origin) and sends no
 * Referer, and the OpenStreetMap Foundation's tile servers (like most free
 * tile services) refuse such requests under their usage policy, which asks
 * for an identifying User-Agent and a Referer. The server sends both, caches
 * every tile (memory, bounded; 7 days), and rate-limits per user.
 *
 * Gate: the workspace's control must be enabled and an administrator must
 * have approved `tile.openstreetmap.org` for it (Extensibility → Form
 * controls), exactly like direct network access. The gallery preview
 * (/gallery/controls/map) uses a public, per-address rate-limited variant.
 */

import { isValidTag } from '@/lib/forms/custom-controls/manifest'
import { publicBaseUrl } from '@/lib/deployment'
import { ServiceError, type ServiceContext } from './context'
import { serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- form_controls rows */

export const TILE_HOST = 'tile.openstreetmap.org'
export const TILE_RATE = { max: 600, windowMs: 60_000 } as const
export const PREVIEW_TILE_RATE = { max: 240, windowMs: 60_000 } as const
const MAX_TILE_BYTES = 512 * 1024
const CACHE_MAX = 4000
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000

const cache = new Map<string, { bytes: Uint8Array; type: string; expires: number }>()

/** Valid tile coordinates (z 0-19, x / y inside the zoom level). */
export function tileCoords(z: unknown, x: unknown, y: unknown): { z: number; x: number; y: number } | null {
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : NaN)
  const zz = n(z)
  const xx = n(x)
  const yy = n(String(y ?? '').replace(/\.png$/, ''))
  if (!Number.isInteger(zz) || zz < 0 || zz > 19) return null
  const max = 2 ** zz - 1
  if (!Number.isInteger(xx) || !Number.isInteger(yy) || xx < 0 || yy < 0 || xx > max || yy > max) return null
  return { z: zz, x: xx, y: yy }
}

/** The tile, from the cache or OpenStreetMap (identifying User-Agent and Referer, 8 s timeout). */
export async function fetchTile(coords: { z: number; x: number; y: number }, deps: { fetch?: typeof fetch; now?: () => number } = {}): Promise<{ bytes: Uint8Array; type: string }> {
  const now = (deps.now ?? Date.now)()
  const key = `${coords.z}/${coords.x}/${coords.y}`
  const hit = cache.get(key)
  if (hit && hit.expires > now) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const appUrl = publicBaseUrl()
  const response = await (deps.fetch ?? fetch)(`https://${TILE_HOST}/${key}.png`, {
    headers: { 'User-Agent': `UserTasks form controls (+${appUrl})`, Referer: `${appUrl}/`, Accept: 'image/png' },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new ServiceError('internal', `The tile server answered ${response.status}`, { status: 502 })
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new ServiceError('internal', 'The tile server did not return an image', { status: 502 })
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_TILE_BYTES) throw new ServiceError('internal', 'The tile is too large', { status: 502 })
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  const entry = { bytes, type, expires: now + CACHE_TTL_MS }
  cache.set(key, entry)
  return entry
}

export function clearTileCache(): void {
  cache.clear()
}

async function limited(key: string, rate: { max: number; windowMs: number }) {
  const { rateLimit } = await import('@/lib/rate-limit')
  const hit = await rateLimit(key, rate)
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many map tiles — wait a moment', { details: { retry_after_ms: hit.retryAfterMs } })
}

/**
 * A tile for a control in the caller's workspace: the control is enabled and
 * an administrator approved tile.openstreetmap.org for it.
 */
export async function controlTile(ctx: ServiceContext, tag: string, coords: { z: number; x: number; y: number }): Promise<{ bytes: Uint8Array; type: string }> {
  if (!ctx.actorId) throw ServiceError.forbidden('Sign in to load map tiles')
  if (!isValidTag(tag)) throw ServiceError.notFound('Form control not found')
  const db = await serviceRoleClient(ctx)
  const { data: row } = await (db as any).from('form_controls').select('enabled, approved_hosts').eq('tenant_id', ctx.tenantId).eq('tag', tag).maybeSingle()
  if (!row?.enabled) throw ServiceError.notFound('Form control not found')
  if (!(row.approved_hosts ?? []).includes(TILE_HOST)) throw ServiceError.forbidden(`An administrator has not approved ${TILE_HOST} for this control`)
  await limited(`control-tiles:${ctx.tenantId}:${ctx.actorId}`, TILE_RATE)
  return fetchTile(coords)
}

/** A tile for the website's live preview of the official map control (public, per address). */
export async function previewTile(address: string, coords: { z: number; x: number; y: number }): Promise<{ bytes: Uint8Array; type: string }> {
  await limited(`preview-tiles:${address}`, PREVIEW_TILE_RATE)
  return fetchTile(coords)
}
