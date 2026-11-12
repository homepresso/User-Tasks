/**
 * Self-hosted Google Fonts (server only): the stylesheet and font-file
 * routes behind lib/fonts/google.ts googleFontHref.
 *
 *   GET /fonts/g/<slug>/<variant>.css                      app/fonts/g/[family]/[variant]/route.ts
 *   GET /fonts/g/<slug>/<variant>/<dir>/<v>/<name>.woff2   …/[variant]/[...file]/route.ts
 *
 * `<variant>` is the family's (googleFontVariant: its upright and italic
 * weights): one stylesheet per family, so one cache entry and one upstream
 * fetch each.
 *   GET /fonts/status                                  app/fonts/status/route.ts
 *
 * Visitors' browsers only ever talk to us. On the first request for a
 * stylesheet the server asks fonts.googleapis.com/css2 for it (woff2, every
 * subset Google serves — latin and latin-ext included — split by
 * unicode-range so a browser only downloads the ranges a page uses), rebuilds
 * it from the @font-face rules it can validate (unknown properties, other
 * hosts or formats are dropped), points every `src` at our file route and
 * stores the result in the storage provider. A font file is fetched from
 * fonts.gstatic.com the first time someone needs it, checked (woff2 magic,
 * size cap) and stored the same way. After that nothing leaves the server.
 *
 * Not an open proxy: the family must be in the bundled catalogue and the
 * variant the family's own, the only hosts ever contacted are
 * fonts.googleapis.com and fonts.gstatic.com (https, no redirects, DNS
 * checked against private ranges, timeouts, size caps, content types
 * checked), and a font file is served only when the stylesheet it belongs to
 * names it. Upstream fetches (cache misses) are rate limited.
 *
 * Remote fetching can be turned off (FONTS_REMOTE=off, or the instance
 * setting instance.fonts_remote = false): air-gapped installs then serve only
 * what is already stored (seed it with `usertasks-admin fonts seed` / `fonts import`), and pages fall
 * back to each family's category stack for the rest.
 */

import { createHash } from 'node:crypto'
import type { StorageProvider } from '@/lib/providers/storage/types'
import {
  GOOGLE_FONT_ROUTE, findGoogleFont, findGoogleFontBySlug, googleFontHref, googleFontVariant, isGoogleFontVariant, type GoogleFont,
} from './google'

export const FONTS_BUCKET = 'task-files'
export const FONTS_PREFIX = 'google-fonts'
export const FONTS_REMOTE_SETTING = 'instance.fonts_remote'
export const FONTS_REMOTE_ENV = 'FONTS_REMOTE'

export const GOOGLE_CSS_HOST = 'fonts.googleapis.com'
export const GOOGLE_FILE_HOST = 'fonts.gstatic.com'
const ALLOWED_HOSTS = new Set([GOOGLE_CSS_HOST, GOOGLE_FILE_HOST])
/** Google picks the font format by user agent: a current browser gets woff2. */
const WOFF2_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const CSS_MAX_BYTES = 1024 * 1024
export const FILE_MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 30_000
/** Upstream fetches per minute (cache misses only; stored fonts are never limited). */
export const REMOTE_FETCHES_PER_MINUTE = 600
const IMMUTABLE = 'public, max-age=31536000, immutable'

const GSTATIC_URL_RE = /^https:\/\/fonts\.gstatic\.com\/s\/([a-z0-9]{1,64})\/(v\d{1,4})\/([A-Za-z0-9_-]{1,200})\.woff2$/
const FILE_DIR_RE = /^[a-z0-9]{1,64}$/
const FILE_VERSION_RE = /^v\d{1,4}$/
const FILE_NAME_RE = /^[A-Za-z0-9_-]{1,200}\.woff2$/

export class FontFetchError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message)
    this.name = 'FontFetchError'
  }
}

export interface FontServeDeps {
  storage: () => Promise<StorageProvider>
  /** Whether upstream fetches are allowed (default: fontsRemoteEnabled()). */
  remoteEnabled?: () => Promise<boolean>
  fetchImpl?: typeof fetch
  /** Checks a host's DNS answers aren't private (default: lib/egress-guard assertSafeEgressHost). */
  checkHost?: (host: string) => Promise<void>
  /** A cache-miss slot; false = over the limit (default: lib/rate-limit, REMOTE_FETCHES_PER_MINUTE). */
  allowFetch?: () => Promise<boolean>
}

/* ── Remote switch ─────────────────────────────────────────────────── */

const OFF = /^(0|false|off|no|disabled|none)$/i
const ON = /^(1|true|on|yes|enabled)$/i

/** FONTS_REMOTE (env, wins) → instance.fonts_remote → on. */
export function resolveFontsRemote(env: string | undefined, setting: unknown): boolean {
  const e = env?.trim()
  if (e && OFF.test(e)) return false
  if (e && ON.test(e)) return true
  if (setting === false || (typeof setting === 'string' && OFF.test(setting.trim()))) return false
  return true
}

export async function fontsRemoteEnabled(): Promise<boolean> {
  let setting: unknown
  try {
    const { getInstanceSetting } = await import('@/lib/config/instance-settings')
    setting = await getInstanceSetting(FONTS_REMOTE_SETTING)
  } catch { /* no settings store: env and the default decide */ }
  return resolveFontsRemote(process.env[FONTS_REMOTE_ENV], setting)
}

/* ── Keys and URLs ─────────────────────────────────────────────────── */

export function cssKey(font: GoogleFont): string {
  return `${FONTS_PREFIX}/css/${font.slug}/${googleFontVariant(font)}.css`
}

export function fileKey(dir: string, version: string, name: string): string {
  return `${FONTS_PREFIX}/files/${dir}/${version}/${name}`
}

/** Our URL for a gstatic file within one stylesheet. */
export function fileUrl(font: GoogleFont, dir: string, version: string, name: string): string {
  return `${GOOGLE_FONT_ROUTE}/${font.slug}/${googleFontVariant(font)}/${dir}/${version}/${name}`
}

/** The css2 request for every face of a family (upright weights, and italics when it has them). */
export function googleCssUrl(font: GoogleFont): string {
  // css2 wants the tuples sorted: all upright (0,w) then italic (1,w).
  const axes = font.italics.length
    ? `ital,wght@${[...font.weights.map((w) => `0,${w}`), ...font.italics.map((w) => `1,${w}`)].join(';')}`
    : `wght@${font.weights.join(';')}`
  return `https://${GOOGLE_CSS_HOST}/css2?family=${font.family.replace(/ /g, '+')}:${axes}&display=swap`
}

/* ── Stylesheet rewriting ──────────────────────────────────────────── */

const FONT_FACE_RE = /(?:\/\*\s*([^*]{0,60}?)\s*\*\/\s*)?@font-face\s*\{([^{}]*)\}/g
const WEIGHT_RE = /^[1-9]00(?: [1-9]00)?$/
const STRETCH_RE = /^\d{1,3}(?:\.\d{1,3})?%(?: \d{1,3}(?:\.\d{1,3})?%)?$/
const RANGE_RE = /^U\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?(?:,\s*U\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?)*$/
const SUBSET_COMMENT_RE = /^(?:\[\d{1,4}\]|[a-z][a-z0-9-]{0,40})$/

export interface RewrittenCss {
  css: string
  /** gstatic URL by our file URL. */
  files: Map<string, string>
}

/**
 * Google's css2 answer → our stylesheet. Each @font-face is rebuilt from the
 * declarations that pass a strict grammar (family = the requested family,
 * style, weight, stretch, unicode-range, a gstatic woff2 `src`); a block
 * missing a valid src is dropped, as is anything outside @font-face blocks.
 * font-display is always swap.
 */
export function rewriteGoogleCss(source: string, font: GoogleFont): RewrittenCss {
  const files = new Map<string, string>()
  const blocks: string[] = []
  for (const m of source.matchAll(FONT_FACE_RE)) {
    const decls = new Map<string, string>()
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':')
      if (i < 0) continue
      decls.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim())
    }
    const family = decls.get('font-family')?.replace(/^['"]|['"]$/g, '')
    if (family !== font.family) continue
    const src = /^url\(([^()'"\s]+)\)\s*format\(['"]woff2['"]\)$/.exec(decls.get('src') ?? '')
    const g = src ? GSTATIC_URL_RE.exec(src[1]) : null
    if (!g) continue
    const style = decls.get('font-style') ?? 'normal'
    if (style !== 'normal' && style !== 'italic') continue
    const weight = decls.get('font-weight') ?? '400'
    if (!WEIGHT_RE.test(weight)) continue
    const stretch = decls.get('font-stretch')
    const range = decls.get('unicode-range')
    const ours = fileUrl(font, g[1], g[2], `${g[3]}.woff2`)
    files.set(ours, src![1])
    const comment = m[1] && SUBSET_COMMENT_RE.test(m[1].trim()) ? `/* ${m[1].trim()} */\n` : ''
    blocks.push(`${comment}@font-face {\n  font-family: '${font.family}';\n  font-style: ${style};\n  font-weight: ${weight};\n${stretch && STRETCH_RE.test(stretch) ? `  font-stretch: ${stretch};\n` : ''}  font-display: swap;\n  src: url(${ours}) format('woff2');\n${range && RANGE_RE.test(range) ? `  unicode-range: ${range};\n` : ''}}`)
  }
  return { css: blocks.length ? `/* ${font.family}: Google Fonts, served by this site (SIL Open Font License / Apache License 2.0). */\n${blocks.join('\n')}\n` : '', files }
}

/* ── Upstream ──────────────────────────────────────────────────────── */

async function defaultAllowFetch(): Promise<boolean> {
  const { rateLimit } = await import('@/lib/rate-limit')
  return (await rateLimit('google-fonts:remote', { max: REMOTE_FETCHES_PER_MINUTE, windowMs: 60_000 })).ok
}

async function defaultCheckHost(host: string): Promise<void> {
  const { assertSafeEgressHost } = await import('@/lib/egress-guard')
  await assertSafeEgressHost(host)
}

/** GET one of the two Google hosts: https only, no redirects, a timeout, a size cap and the expected content type. */
export async function fetchGoogle(url: string, kind: 'css' | 'font', deps: FontServeDeps): Promise<Uint8Array> {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new FontFetchError('Bad upstream URL', 400) }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.port || parsed.username || parsed.password) {
    throw new FontFetchError(`Fonts are only fetched from ${GOOGLE_CSS_HOST} and ${GOOGLE_FILE_HOST}`, 400)
  }
  if ((kind === 'css') !== (parsed.hostname === GOOGLE_CSS_HOST)) throw new FontFetchError('Wrong host for this request', 400)
  if (!(await (deps.allowFetch ?? defaultAllowFetch)())) throw new FontFetchError('Too many font downloads; try again shortly', 503)
  await (deps.checkHost ?? defaultCheckHost)(parsed.hostname)
  let res: Response
  try {
    res = await (deps.fetchImpl ?? fetch)(parsed.toString(), {
      headers: { 'User-Agent': WOFF2_USER_AGENT, Accept: kind === 'css' ? 'text/css' : 'font/woff2' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new FontFetchError(`Could not reach Google Fonts (${(error as Error)?.name === 'TimeoutError' ? 'timed out' : 'network error'})`)
  }
  if (res.status === 400 || res.status === 404) throw new FontFetchError('Google Fonts has no such font', 404)
  if (!res.ok) throw new FontFetchError(`Google Fonts answered ${res.status}`)
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const okType = kind === 'css' ? type === 'text/css' : type === 'font/woff2' || type === 'application/octet-stream'
  if (!okType) { await res.body?.cancel().catch(() => {}); throw new FontFetchError(`Unexpected content type ${type || '(none)'}`) }
  const max = kind === 'css' ? CSS_MAX_BYTES : FILE_MAX_BYTES
  if (Number(res.headers.get('content-length') ?? 0) > max) { await res.body?.cancel().catch(() => {}); throw new FontFetchError('Font response too large') }
  const reader = res.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > max) { await reader.cancel().catch(() => {}); throw new FontFetchError('Font response too large') }
        chunks.push(value)
      }
    } catch (error) {
      if (error instanceof FontFetchError) throw error
      throw new FontFetchError(`Google Fonts download failed (${(error as Error)?.name === 'TimeoutError' ? 'timed out' : 'network error'})`)
    }
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  if (kind === 'font' && !isWoff2(out)) throw new FontFetchError('Not a woff2 font')
  return out
}

export function isWoff2(bytes: Uint8Array): boolean {
  return bytes.length > 48 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32 // "wOF2"
}

/* ── Stored stylesheets ────────────────────────────────────────────── */

/** Recently used stylesheets (both routes read them on every request). */
const cssCache = new Map<string, string>()
const CSS_CACHE_MAX = 300

function remember(key: string, css: string) {
  if (cssCache.size >= CSS_CACHE_MAX) cssCache.delete(cssCache.keys().next().value as string)
  cssCache.set(key, css)
}

/** Test hook. */
export function clearFontCaches(): void {
  cssCache.clear()
  cachedFamilies = null
}

async function readStored(storage: StorageProvider, key: string): Promise<Uint8Array | null> {
  try {
    const obj = await storage.get(FONTS_BUCKET, key)
    if (!obj) return null
    const { readAll } = await import('@/lib/providers/storage/types')
    return await readAll(obj.body)
  } catch {
    return null
  }
}

async function store(storage: StorageProvider, key: string, body: Uint8Array, contentType: string): Promise<void> {
  try {
    await storage.put(FONTS_BUCKET, key, body, { contentType, cacheControl: '31536000', upsert: true })
  } catch (error) {
    // Still served this time; the next request fetches again.
    console.warn(`[fonts] could not store ${key}: ${(error as Error)?.message ?? error}`)
  }
}

/** Stylesheet loads in progress (concurrent first requests for a family share one upstream fetch). */
const cssInFlight = new Map<string, Promise<string | null>>()

/** Our stylesheet for a family: memory, then storage, then (remote on) Google. Null when unavailable offline. */
export async function loadFontCss(font: GoogleFont, deps: FontServeDeps): Promise<string | null> {
  const key = cssKey(font)
  const hit = cssCache.get(key)
  if (hit !== undefined) return hit
  const pending = cssInFlight.get(key)
  if (pending) return pending
  const load = loadFontCssOnce(font, deps).finally(() => cssInFlight.delete(key))
  cssInFlight.set(key, load)
  return load
}

async function loadFontCssOnce(font: GoogleFont, deps: FontServeDeps): Promise<string | null> {
  const key = cssKey(font)
  const hit = cssCache.get(key)
  if (hit !== undefined) return hit
  const storage = await deps.storage()
  const stored = await readStored(storage, key)
  if (stored) {
    const css = new TextDecoder().decode(stored)
    remember(key, css)
    return css
  }
  if (!(await (deps.remoteEnabled ?? fontsRemoteEnabled)())) return null
  const raw = new TextDecoder().decode(await fetchGoogle(googleCssUrl(font), 'css', deps))
  const { css } = rewriteGoogleCss(raw, font)
  if (!css) throw new FontFetchError('Google Fonts returned no usable font faces')
  await store(storage, key, new TextEncoder().encode(css), 'text/css; charset=utf-8')
  remember(key, css)
  cachedFamilies = null
  return css
}

/* ── Responses ─────────────────────────────────────────────────────── */

function textResponse(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } })
}

function errorResponse(error: unknown): Response {
  if (error instanceof FontFetchError) return textResponse(error.status, error.message, error.status === 503 ? { 'Retry-After': '30' } : {})
  console.warn(`[fonts] ${(error as Error)?.message ?? error}`)
  return textResponse(502, 'Font unavailable')
}

const notFound = () => textResponse(404, 'Not found')

function parseRequest(slug: string, variant: string): GoogleFont | null {
  const font = findGoogleFontBySlug(slug)
  if (!font || font.bundledVar) return null
  return isGoogleFontVariant(font, variant) ? font : null
}

/** GET /fonts/g/<slug>/<variant>.css */
export async function serveFontCss(request: Request, slug: string, variantFile: string, deps: FontServeDeps): Promise<Response> {
  if (!variantFile.endsWith('.css')) return notFound()
  const font = parseRequest(slug, variantFile.slice(0, -4))
  if (!font) return notFound()
  try {
    const css = await loadFontCss(font, deps)
    if (css === null) return notFound()
    const etag = `"${createHash('sha256').update(css).digest('base64url').slice(0, 27)}"`
    const headers = { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': IMMUTABLE, ETag: etag, 'X-Content-Type-Options': 'nosniff' }
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
    return new Response(request.method === 'HEAD' ? null : css, { status: 200, headers })
  } catch (error) {
    return errorResponse(error)
  }
}

/** GET /fonts/g/<slug>/<variant>/<dir>/<v>/<name>.woff2 */
export async function serveFontFile(request: Request, slug: string, variant: string, segments: string[], deps: FontServeDeps): Promise<Response> {
  const font = parseRequest(slug, variant)
  if (!font || segments.length !== 3) return notFound()
  const [dir, version, name] = segments
  if (!FILE_DIR_RE.test(dir) || !FILE_VERSION_RE.test(version) || !FILE_NAME_RE.test(name)) return notFound()
  const headers = { 'Content-Type': 'font/woff2', 'Cache-Control': IMMUTABLE, 'X-Content-Type-Options': 'nosniff' }
  try {
    // Only files the family's stylesheet names (no fetching arbitrary gstatic paths).
    const css = await loadFontCss(font, deps)
    const ours = fileUrl(font, dir, version, name)
    if (css === null || !css.includes(`url(${ours})`)) return notFound()
    const storage = await deps.storage()
    const key = fileKey(dir, version, name)
    let bytes = await readStored(storage, key)
    if (!bytes) {
      if (!(await (deps.remoteEnabled ?? fontsRemoteEnabled)())) return notFound()
      bytes = await fetchGoogle(`https://${GOOGLE_FILE_HOST}/s/${dir}/${version}/${name}`, 'font', deps)
      await store(storage, key, bytes, 'font/woff2')
    }
    if (!isWoff2(bytes)) return notFound()
    return new Response(request.method === 'HEAD' ? null : (bytes as unknown as BodyInit), { status: 200, headers: { ...headers, 'Content-Length': String(bytes.byteLength) } })
  } catch (error) {
    return errorResponse(error)
  }
}

/* ── Status (pickers) ──────────────────────────────────────────────── */

let cachedFamilies: { at: number; families: string[] } | null = null
const FAMILIES_TTL_MS = 60_000

/** Families with at least one stored stylesheet (most popular first). */
export async function storedFontFamilies(deps: Pick<FontServeDeps, 'storage'>): Promise<string[]> {
  if (cachedFamilies && Date.now() - cachedFamilies.at < FAMILIES_TTL_MS) return cachedFamilies.families
  const slugs = new Set<string>()
  try {
    const storage = await deps.storage()
    let cursor: string | null = null
    for (let page = 0; page < 50; page++) {
      const res = await storage.list(FONTS_BUCKET, `${FONTS_PREFIX}/css/`, { limit: 1000, cursor })
      for (const o of res.objects) {
        const m = /(?:^|\/)css\/([a-z0-9-]+)\/w[0-9a-f]+(?:-i[0-9a-f]+)?\.css$/.exec(o.key)
        if (m) slugs.add(m[1])
      }
      cursor = res.cursor
      if (!cursor) break
    }
  } catch { /* nothing stored / store unreachable */ }
  const families = [...slugs].map((s) => findGoogleFontBySlug(s)).filter((f): f is GoogleFont => Boolean(f)).map((f) => f.family)
  cachedFamilies = { at: Date.now(), families }
  return families
}

export interface FontStatus {
  /** Whether fonts not stored yet can be fetched. */
  remote: boolean
  /** Families stored on this instance (all of them usable with remote off). */
  stored: string[]
}

export async function fontStatus(deps: FontServeDeps): Promise<FontStatus> {
  const [remote, stored] = await Promise.all([(deps.remoteEnabled ?? fontsRemoteEnabled)(), storedFontFamilies(deps)])
  return { remote, stored }
}

/* ── Seeding (usertasks-admin fonts seed) ──────────────────────────────────── */

/** Fetch and store a family's stylesheet and every font file it names (pre-seeding before going offline). */
export async function seedGoogleFont(family: string, deps: FontServeDeps): Promise<{ family: string; href: string | null; files: number; fetched: number }> {
  const font = findGoogleFont(family)
  if (!font) throw new FontFetchError(`"${family}" is not a Google Fonts family`, 404)
  if (font.bundledVar) return { family: font.family, href: null, files: 0, fetched: 0 }
  const online = { ...deps, remoteEnabled: async () => true }
  const css = await loadFontCss(font, online)
  if (!css) throw new FontFetchError('No stylesheet')
  const storage = await deps.storage()
  let files = 0
  let fetched = 0
  for (const m of css.matchAll(/url\((\/fonts\/g\/[^)]+)\)/g)) {
    const [dir, version, name] = m[1].split('/').slice(-3)
    const key = fileKey(dir, version, name)
    files++
    if (await storage.head(FONTS_BUCKET, key).catch(() => null)) continue
    await store(storage, key, await fetchGoogle(`https://${GOOGLE_FILE_HOST}/s/${dir}/${version}/${name}`, 'font', online), 'font/woff2')
    fetched++
  }
  return { family: font.family, href: googleFontHref(font), files, fetched }
}
