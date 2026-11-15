import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { parseEmbedList, workspaceEmbeddingEnabled, EMBED_WORKSPACE_ORIGINS_ENV } from './embedding'

export { workspaceEmbeddingEnabled, EMBED_WORKSPACE_ORIGINS_ENV }

/**
 * Per-workspace trusted embedding without a database lookup in the proxy.
 *
 * A multi-tenant instance (the cloud edition) cannot use one instance-wide
 * EMBED_FRAME_ANCESTORS list: each workspace approves its own sites (its
 * SharePoint farm, its intranet). The proxy must decide `frame-ancestors` on
 * every embeddable request without reading the database, so the decision
 * travels with the URL as a signed, short-lived token:
 *
 *   /embed/x/<ext>/<path>?…&ut_ea=<payload>.<mac>
 *   payload = base64url({ v: 1, w: <workspace subdomain>, o: [origins], e: <expiry, unix s> })
 *   mac     = HMAC-SHA256(key, payload)
 *
 * Minted server-side (lib/embedding-server.ts embedUrlFor, ctx.embedding.url
 * in extensions) from the workspace's stored list
 * (tenants.settings.embedding.frame_ancestors) whenever UserTasks sends a
 * browser to an embeddable page (e.g. the SharePoint add-in launch
 * redirect). The proxy verifies it and allows framing by those origins only
 * when:
 *   - the MAC matches (nobody can add an origin),
 *   - it has not expired (EMBED_TOKEN_TTL_S, 1 hour: removing an origin
 *     takes effect for new launches at once, for open ones within the hour),
 *   - the request's Host is that workspace's own address
 *     (<w>.<base domain>), so a token minted by workspace A (whose admin
 *     approved some origin) can never open workspace B's pages to it.
 * Without workspace addresses (a single-host instance) only the
 * instance-wide list applies.
 *
 * Copying a token to another URL gains nothing: it only lists origins the
 * workspace already approved, and only for that workspace's host.
 *
 * Key: EMBED_SIGNING_SECRET, else derived (HKDF-SHA256) from ENCRYPTION_KEY.
 * Without either, workspace tokens are neither minted nor accepted.
 */

export const EMBED_TOKEN_PARAM = 'ut_ea'
export const EMBED_TOKEN_TTL_S = 3600
const KEY_INFO = 'usertasks:embed-token:v1'
const MAX_ORIGINS = 20

export interface EmbedTokenPayload {
  v: 1
  /** Workspace subdomain the token is valid on. */
  w: string
  /** Normalised origins (lib/embedding parseFrameAncestor). */
  o: string[]
  /** Expiry, unix seconds. */
  e: number
}

let cachedKey: { material: string; key: Buffer } | null = null

export function embedTokenKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const dedicated = env.EMBED_SIGNING_SECRET?.trim()
  const base = env.ENCRYPTION_KEY?.trim()
  const material = dedicated ? `d:${dedicated}` : base && !base.startsWith('secret://') ? `e:${base}` : ''
  if (!material) return null
  if (cachedKey?.material === material) return cachedKey.key
  const key = dedicated
    ? Buffer.from(dedicated, 'utf8')
    : Buffer.from(hkdfSync('sha256', Buffer.from(base!, 'utf8'), Buffer.alloc(0), KEY_INFO, 32))
  cachedKey = { material, key }
  return key
}

function mac(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/** Mint a token (null when no key is configured or there is nothing to allow). */
export function mintEmbedToken(input: { workspace: string; origins: string[]; now?: number; ttlS?: number }, key: Buffer | null = embedTokenKey()): string | null {
  if (!key || !input.workspace || !/^[a-z0-9-]{1,63}$/.test(input.workspace)) return null
  const { origins } = parseEmbedList(input.origins)
  if (!origins.length) return null
  const payload: EmbedTokenPayload = { v: 1, w: input.workspace, o: origins.slice(0, MAX_ORIGINS), e: Math.floor((input.now ?? Date.now()) / 1000) + (input.ttlS ?? EMBED_TOKEN_TTL_S) }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${mac(key, encoded)}`
}

/**
 * Origins a token allows on this workspace host, or [] when it is missing,
 * forged, expired or minted for another workspace.
 */
export function verifyEmbedToken(token: string | null | undefined, workspace: string | null, options: { now?: number; key?: Buffer | null } = {}): string[] {
  if (!token || !workspace || token.length > 4096) return []
  const key = options.key === undefined ? embedTokenKey() : options.key
  if (!key) return []
  const dot = token.indexOf('.')
  if (dot <= 0) return []
  const encoded = token.slice(0, dot)
  const presented = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(mac(key, encoded), 'base64url')
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return []
  let payload: EmbedTokenPayload
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) } catch { return [] }
  if (payload?.v !== 1 || payload.w !== workspace || typeof payload.e !== 'number') return []
  if (payload.e * 1000 < (options.now ?? Date.now())) return []
  return parseEmbedList(Array.isArray(payload.o) ? payload.o : []).origins.slice(0, MAX_ORIGINS)
}
