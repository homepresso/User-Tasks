/**
 * Embedded designers (trusted embedding, lib/embedding.ts): the workflow and
 * form designers without the app shell, for a page on a site the operator
 * approved (EMBED_FRAME_ANCESTORS) — e.g. a SharePoint page that edits the
 * workflow or form of one of its lists. The designers themselves are the
 * normal ones; only the frame around them changes.
 *
 *   /embed/workflows/<id>            the workflow designer
 *   /embed/workflows/<id>/runs       its runs
 *   /embed/runs/<run id>             one run
 *   /embed/forms/<id>/design         the form designer
 *
 * Launch parameters (all optional):
 *   return=<absolute URL>   where "Back" / "Done" go — accepted only when its
 *                           origin is one of the approved embedding origins
 *                           (never an open redirect); navigates the TOP window.
 *   return_label=<text>     "Back to <text>" (the list's name).
 *   host_origin=<origin>    the embedding page's origin when there is no
 *                           `return` (same rule); messages go only there.
 *   header=0                no compact header (the host draws its own).
 *   ut_ea=<token>           per-workspace trusted embedding (lib/embedding-token.ts,
 *                           ctx.embedding.url): carried to every page of the embed.
 *
 * Inside the frame, links that would open another app area stay inside the
 * embed when an /embed/ equivalent exists (embedPathFor), otherwise open in a
 * new tab: every other page refuses to be framed, and a client-side jump into
 * the full app would show its shell inside the host page.
 *
 * Host messages (window.postMessage, to `host_origin` / the return origin
 * only; see DesignerMessage): ready, state (dirty, name), done, deleted. The
 * host answers `done` with { type: 'usertasks:host', event: 'ack' } when it
 * navigates itself; without an answer the frame navigates the top window.
 *
 * Pure and dependency-free (server, client and proxy may import it).
 */

import { parseFrameAncestor } from '@/lib/embedding'

export const EMBED_RETURN_PARAM = 'return'
export const EMBED_RETURN_LABEL_PARAM = 'return_label'
export const EMBED_HOST_ORIGIN_PARAM = 'host_origin'
export const EMBED_HEADER_PARAM = 'header'
/** Per-workspace trusted embedding: the signed origins token (lib/embedding-token.ts), checked by the proxy on every framed load. */
export const EMBED_WORKSPACE_TOKEN_PARAM = 'ut_ea'
/** The parameters that follow the person from page to page inside the embed. */
export const EMBED_CARRIED_PARAMS = [EMBED_RETURN_PARAM, EMBED_RETURN_LABEL_PARAM, EMBED_HOST_ORIGIN_PARAM, EMBED_HEADER_PARAM, EMBED_WORKSPACE_TOKEN_PARAM] as const

/** sessionStorage: the launch parameters of the current frame (the dashboard shell's escape guard re-attaches them). */
export const EMBED_SESSION_KEY = 'usertasks:embed-launch'

export const DESIGNER_MESSAGE_TYPE = 'usertasks:designer'
export const HOST_MESSAGE_TYPE = 'usertasks:host'

export type DesignerKind = 'workflow' | 'form' | 'runs' | 'run'

/** What the embedded designer tells its host page. */
export type DesignerMessage =
  | { type: typeof DESIGNER_MESSAGE_TYPE; event: 'ready'; kind: DesignerKind; id: string; name: string | null; layout: 'fill' }
  | { type: typeof DESIGNER_MESSAGE_TYPE; event: 'state'; kind: DesignerKind; id: string; name: string | null; dirty: boolean }
  | { type: typeof DESIGNER_MESSAGE_TYPE; event: 'done'; kind: DesignerKind; id: string; returnUrl: string | null }
  | { type: typeof DESIGNER_MESSAGE_TYPE; event: 'deleted'; kind: DesignerKind; id: string; returnUrl: string | null }

/** What a host page may tell the designer. */
export type HostMessage = { type: typeof HOST_MESSAGE_TYPE; event: 'ack' }

export function isHostMessage(data: unknown): data is HostMessage {
  return Boolean(data) && typeof data === 'object' && (data as HostMessage).type === HOST_MESSAGE_TYPE && (data as HostMessage).event === 'ack'
}

export function isDesignerMessage(data: unknown): data is DesignerMessage {
  return Boolean(data) && typeof data === 'object' && (data as DesignerMessage).type === DESIGNER_MESSAGE_TYPE
    && ['ready', 'state', 'done', 'deleted'].includes(String((data as DesignerMessage).event))
}

/* ── origins ─────────────────────────────────────────────────────────── */

/**
 * Is `origin` (scheme://host[:port]) one of the approved origins (the
 * normalised EMBED_FRAME_ANCESTORS list)? `https://*.contoso.com` matches any
 * subdomain on the default port, as in CSP.
 */
export function originApproved(origin: string, approved: readonly string[]): boolean {
  const parsed = parseFrameAncestor(origin)
  if ('error' in parsed || parsed.origin.includes('*')) return false
  const candidate = parsed.origin
  for (const entry of approved) {
    if (entry === candidate) return true
    const m = /^(https?):\/\/\*\.(.+)$/.exec(entry)
    if (!m) continue
    const c = /^(https?):\/\/([^:/]+)$/.exec(candidate)
    if (c && c[1] === m[1] && c[2].endsWith(`.${m[2]}`)) return true
  }
  return false
}

export interface EmbedReturn {
  /** Absolute URL, approved origin. */
  url: string
  origin: string
  /** "Back to <label>" text (default "Back"). */
  label: string
}

/** The `return` target, when it is an http(s) URL on an approved origin (else null: no Back / Done link). */
export function parseEmbedReturn(raw: unknown, rawLabel: unknown, approved: readonly string[]): EmbedReturn | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value || value.length > 2000 || /[\s\\]/.test(value)) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
  if (!originApproved(url.origin, approved)) return null
  const text = typeof rawLabel === 'string' ? rawLabel.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  return { url: url.toString(), origin: url.origin.toLowerCase(), label: text ? `Back to ${text}` : 'Back' }
}

/** The host page's origin: the return target's, else `host_origin` when approved, else null (no messages). */
export function embedHostOrigin(ret: EmbedReturn | null, rawHostOrigin: unknown, approved: readonly string[]): string | null {
  if (ret) return ret.origin
  const value = typeof rawHostOrigin === 'string' ? rawHostOrigin.trim().replace(/\/+$/, '') : ''
  if (!value) return null
  const parsed = parseFrameAncestor(value)
  if ('error' in parsed || parsed.origin.includes('*')) return null
  return originApproved(parsed.origin, approved) ? parsed.origin : null
}

/** The launch parameters of an embedded designer page, validated; only valid values travel on (pure). */
export function parseLaunchOptions(query: Record<string, string | string[] | undefined>, approved: readonly string[]) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const ret = parseEmbedReturn(one(query[EMBED_RETURN_PARAM]), one(query[EMBED_RETURN_LABEL_PARAM]), approved)
  const hostOrigin = embedHostOrigin(ret, one(query[EMBED_HOST_ORIGIN_PARAM]), approved)
  const header = one(query[EMBED_HEADER_PARAM]) !== '0'
  const carried: Record<string, string> = {}
  for (const key of EMBED_CARRIED_PARAMS) {
    const value = one(query[key])
    if (value) carried[key] = value
  }
  if (!ret) { delete carried[EMBED_RETURN_PARAM]; delete carried[EMBED_RETURN_LABEL_PARAM] }
  if (!hostOrigin) delete carried[EMBED_HOST_ORIGIN_PARAM]
  // Opaque to the page (the proxy verifies it): only its shape is checked here.
  if (carried[EMBED_WORKSPACE_TOKEN_PARAM] && !/^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,128}$/.test(carried[EMBED_WORKSPACE_TOKEN_PARAM])) delete carried[EMBED_WORKSPACE_TOKEN_PARAM]
  return { ret, hostOrigin, header, carried }
}

/* ── paths ───────────────────────────────────────────────────────────── */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const APP_TO_EMBED: Array<[RegExp, (id: string) => string]> = [
  [new RegExp(`^/automations/(${UUID})/?$`, 'i'), (id) => `/embed/workflows/${id}`],
  [new RegExp(`^/automations/(${UUID})/runs/?$`, 'i'), (id) => `/embed/workflows/${id}/runs`],
  [new RegExp(`^/automations/runs/(${UUID})/?$`, 'i'), (id) => `/embed/runs/${id}`],
  [new RegExp(`^/automations/forms/(${UUID})/?$`, 'i'), (id) => `/embed/forms/${id}/design`],
]
const EMBED_TO_APP: Array<[RegExp, (id: string) => string]> = [
  [new RegExp(`^/embed/workflows/(${UUID})/?$`, 'i'), (id) => `/automations/${id}`],
  [new RegExp(`^/embed/workflows/(${UUID})/runs/?$`, 'i'), (id) => `/automations/${id}/runs`],
  [new RegExp(`^/embed/runs/(${UUID})/?$`, 'i'), (id) => `/automations/runs/${id}`],
  [new RegExp(`^/embed/forms/(${UUID})/design/?$`, 'i'), (id) => `/automations/forms/${id}`],
]

function splitPath(path: string): { pathname: string; rest: string } {
  const i = path.search(/[?#]/)
  return i < 0 ? { pathname: path, rest: '' } : { pathname: path.slice(0, i), rest: path.slice(i) }
}

/**
 * The /embed/ equivalent of an app path (query and hash kept), or null when
 * that area has none (→ open it in a new tab). Paths already under /embed/
 * are returned as they are.
 */
export function embedPathFor(appPath: string): string | null {
  if (!appPath.startsWith('/') || appPath.startsWith('//')) return null
  const { pathname, rest } = splitPath(appPath)
  if (pathname.startsWith('/embed/')) return appPath
  for (const [re, to] of APP_TO_EMBED) {
    const m = re.exec(pathname)
    if (m) return `${to(m[1].toLowerCase())}${rest}`
  }
  return null
}

/** The full-app page for an embedded designer path ("Open in UserTasks"), or null. */
export function appPathForEmbed(embedPath: string): string | null {
  const { pathname } = splitPath(embedPath)
  for (const [re, to] of EMBED_TO_APP) {
    const m = re.exec(pathname)
    if (m) return to(m[1].toLowerCase())
  }
  return null
}

/** `path` with the launch parameters (return, label, host origin, header) that are not already on it. */
export function withEmbedParams(path: string, carried: Record<string, string | null | undefined>): string {
  const hashAt = path.indexOf('#')
  const hash = hashAt < 0 ? '' : path.slice(hashAt)
  const base = hashAt < 0 ? path : path.slice(0, hashAt)
  const qAt = base.indexOf('?')
  const pathname = qAt < 0 ? base : base.slice(0, qAt)
  const q = new URLSearchParams(qAt < 0 ? '' : base.slice(qAt + 1))
  for (const key of EMBED_CARRIED_PARAMS) {
    const value = carried[key]
    if (value && !q.has(key)) q.set(key, value)
  }
  const s = q.toString()
  return `${pathname}${s ? `?${s}` : ''}${hash}`
}

/** Same-origin app path (no scheme, no //host, no backslash) — for /embed/open?to=. */
export function isSafeAppPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 2000 && /^\/(?![/\\])/.test(path) && !/[\\\r\n\t]/.test(path)
}
