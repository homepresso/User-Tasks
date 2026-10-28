/**
 * The gallery an instance offers in **Automations → Packages → Browse
 * gallery**: Official packages (this instance's own public/gallery files —
 * every instance ships them) plus Community packages.
 *
 *  - On usertasks.com (community gallery enabled) the community entries
 *    come from this instance's database.
 *  - Elsewhere (self-hosted) they come from a public gallery index,
 *    GALLERY_INDEX_URL — by default https://usertasks.com/api/gallery/index —
 *    fetched server-side (egress-guarded, 5 s timeout, 2 MB cap, cached for
 *    five minutes). Only community entries are taken from it, and only those
 *    whose download URL is on the index's own origin. GALLERY_INDEX_URL=off
 *    turns the remote gallery off (air-gapped instances); a failed fetch
 *    simply shows the official packages with a note.
 *
 * Downloads of remote community packages go through the same server
 * (fetchRemotePackage: same origin as the index, 5 MB cap), so the browser
 * never talks to another origin and the CSP stays closed.
 */

import officialIndexJson from '@/public/gallery/index.json'
import { readEnv } from '@/lib/config/bootstrap'
import type { GalleryIndex, GalleryIndexEntry } from './types'

export const DEFAULT_GALLERY_INDEX_URL = 'https://usertasks.com/api/gallery/index'
const REMOTE_TTL_MS = 5 * 60_000
const MAX_INDEX_BYTES = 2 * 1024 * 1024
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024

export interface InstanceGallery {
  index: GalleryIndex
  /** Where the community entries came from: 'local' (this instance), a remote URL, or null (none). */
  community_source: string | null
  /** Set when the remote index could not be read. */
  community_error: string | null
}

/** The official index with every entry marked official. */
export function officialIndex(): GalleryIndex {
  const index = officialIndexJson as unknown as GalleryIndex
  return { ...index, packages: index.packages.map((entry) => ({ ...entry, source: entry.source ?? 'official' })) }
}

/** GALLERY_INDEX_URL (null = off). */
export function galleryIndexUrl(env: string | undefined = readEnv('GALLERY_INDEX_URL')): string | null {
  const raw = String(env ?? '').trim()
  if (/^(off|none|false|0)$/i.test(raw)) return null
  const url = raw || DEFAULT_GALLERY_INDEX_URL
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && readEnv('ALLOW_PRIVATE_EGRESS') === 'true')) return null
    return parsed.toString()
  } catch {
    return null
  }
}

/** Community entries of a remote index that are safe to offer: well-formed, downloads on the index's origin. */
export function acceptRemoteEntries(raw: unknown, indexUrl: string): GalleryIndexEntry[] {
  const origin = new URL(indexUrl).origin
  const packages = (raw && typeof raw === 'object' && Array.isArray((raw as GalleryIndex).packages)) ? (raw as GalleryIndex).packages : []
  const out: GalleryIndexEntry[] = []
  for (const entry of packages.slice(0, 1000)) {
    if (!entry || typeof entry !== 'object' || entry.source !== 'community') continue
    if (typeof entry.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)) continue
    let file: URL
    try { file = new URL(String(entry.file), origin) } catch { continue }
    if (file.origin !== origin || file.pathname !== `/api/gallery/community/${entry.slug}/download`) continue
    out.push({
      ...entry,
      title: String(entry.title ?? entry.slug).slice(0, 80),
      summary: String(entry.summary ?? '').slice(0, 200),
      tags: Array.isArray(entry.tags) ? entry.tags.map(String).slice(0, 8) : [],
      needs: [],
      optional_needs: [],
      systems: [],
      file: file.toString(),
      page: (() => { try { const page = new URL(String(entry.page), origin); return page.origin === origin ? page.toString() : `${origin}/gallery/community/${entry.slug}` } catch { return `${origin}/gallery/community/${entry.slug}` } })(),
      author: entry.author && typeof entry.author === 'object' ? { name: String(entry.author.name ?? '').slice(0, 60), url: typeof entry.author.url === 'string' && /^https?:\/\//.test(entry.author.url) ? entry.author.url : null } : null,
      source: 'community',
    })
  }
  return out
}

async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > max) throw new Error(`response is larger than ${max / 1024 / 1024} MB`)
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array(await response.arrayBuffer())
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel(); throw new Error(`response is larger than ${max / 1024 / 1024} MB`) }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

async function guardedGet(url: string, max: number, accept: string): Promise<Uint8Array> {
  const { assertSafeEgressUrl } = await import('@/lib/egress-guard')
  await assertSafeEgressUrl(url)
  const response = await fetch(url, { headers: { accept }, redirect: 'error', signal: AbortSignal.timeout(5_000), cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return readCapped(response, max)
}

let cache: { url: string; at: number; entries: GalleryIndexEntry[]; error: string | null } | null = null

/** Community entries of the configured remote index (cached). */
export async function remoteCommunityEntries(url: string | null = galleryIndexUrl()): Promise<{ entries: GalleryIndexEntry[]; error: string | null }> {
  if (!url) return { entries: [], error: null }
  if (cache && cache.url === url && Date.now() - cache.at < REMOTE_TTL_MS) return { entries: cache.entries, error: cache.error }
  let entries: GalleryIndexEntry[] = []
  let error: string | null = null
  try {
    const bytes = await guardedGet(url, MAX_INDEX_BYTES, 'application/json')
    entries = acceptRemoteEntries(JSON.parse(Buffer.from(bytes).toString('utf8')), url)
  } catch (e) {
    error = `The community gallery (${new URL(url).host}) could not be reached: ${(e as Error).message}`
  }
  cache = { url, at: Date.now(), entries, error }
  return { entries, error }
}

/** Official + Community, as this instance offers them. */
export async function instanceGallery(): Promise<InstanceGallery> {
  const official = officialIndex()
  const { communityGalleryEnabled, listCommunityPackages, communityIndexEntry } = await import('@/lib/services/gallery-community')
  if (communityGalleryEnabled()) {
    const { publicBaseUrl } = await import('@/lib/deployment')
    const base = publicBaseUrl()
    const community = (await listCommunityPackages()).map((pkg) => communityIndexEntry(pkg, base))
    // Same-origin downloads for this instance's own community packages.
    const local = community.map((entry) => ({ ...entry, file: `/api/gallery/community/${entry.slug}/download` }))
    return { index: { ...official, packages: [...official.packages, ...local] }, community_source: 'local', community_error: null }
  }
  const url = galleryIndexUrl()
  const { entries, error } = await remoteCommunityEntries(url)
  const officialIds = new Set(official.packages.map((p) => p.id))
  return {
    index: { ...official, packages: [...official.packages, ...entries.filter((e) => !officialIds.has(e.id))] },
    community_source: url,
    community_error: error,
  }
}

/** Download a remote community package listed by the configured index (same origin only). */
export async function fetchRemotePackage(slug: string): Promise<{ bytes: Uint8Array; file_name: string }> {
  const url = galleryIndexUrl()
  if (!url) throw new Error('The community gallery is off on this instance (GALLERY_INDEX_URL=off)')
  const { entries } = await remoteCommunityEntries(url)
  const entry = entries.find((e) => e.slug === slug)
  if (!entry) throw new Error('That community package is not in the gallery index')
  const bytes = await guardedGet(entry.file, MAX_PACKAGE_BYTES, 'application/octet-stream')
  return { bytes, file_name: entry.file_name }
}

/** Test hook: forget the cached remote index. */
export function resetRemoteIndexCache() {
  cache = null
}
