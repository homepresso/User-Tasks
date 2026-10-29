import { supabaseUrl } from './config/bootstrap'
import { publicBasesFor, storageConfigSync } from './providers/storage/options'

/**
 * Content-Security-Policy for every response.
 *
 * Built per request from the runtime config (proxy.ts sets it on every
 * matched response), so the policy follows the Supabase URL the server runs
 * with rather than the one present at build time. next.config.ts still sets
 * the same policy, evaluated at build time, for the static paths the proxy
 * skips (_next/static, images); the proxy's header replaces it elsewhere.
 *
 * connect-src is derived from the Supabase URL (SUPABASE_URL, falling back
 * to NEXT_PUBLIC_SUPABASE_URL) instead of a blanket `https: wss:`: the
 * browser only talks to this origin ('self') and the Supabase project (REST,
 * auth, storage over https; realtime over wss). Plain http/ws is allowed only
 * for a loopback Supabase (a local `supabase start` stack on 127.0.0.1 /
 * localhost) — never for a remote host. Without a usable URL the previous
 * `https: wss:` fallback applies so a misconfigured build still signs in.
 *
 * script-src stays permissive ('unsafe-inline') because the App Router
 * injects inline bootstrap scripts; tightening to a nonce-based CSP is a
 * follow-up that needs full-app verification. Everything else is locked
 * down: no framing, no plugins, no base-tag hijack.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** connect-src sources for the configured Supabase URL. */
export function supabaseConnectSources(supabaseUrl: string | undefined): string[] {
  let url: URL
  try {
    url = new URL(String(supabaseUrl ?? '').trim())
  } catch {
    return ['https:', 'wss:']
  }
  const host = url.host // includes a non-default port
  if (url.protocol === 'https:') return [`https://${host}`, `wss://${host}`]
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return [`http://${host}`, `ws://${host}`]
  // A plain-http remote Supabase is not allowed (credentials in clear text).
  return ['https:', 'wss:']
}

/**
 * Extra img/font/media sources for stored files served straight from the
 * store (STORAGE_PUBLIC_BASE_URL). https origins are already covered by
 * `https:`; a plain-http base is allowed only on a loopback host (a local
 * MinIO), like the Supabase rule above. Files served by the app's /files
 * route are 'self'.
 */
export function storageMediaSources(publicBases: Record<string, string> | undefined): string[] {
  const out = new Set<string>()
  for (const base of Object.values(publicBases ?? {})) {
    try {
      const url = new URL(base)
      if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) out.add(`http://${url.host}`)
    } catch {
      // ignore malformed bases
    }
  }
  return [...out]
}

/**
 * connect-src origins the browser PUTs direct uploads to (form attachments
 * over 4 MB go straight to the store through a signed URL): the S3 endpoint
 * (AWS: any amazonaws.com host), the Azure Blob account, Google Cloud
 * Storage. Supabase Storage is already covered by the Supabase origin; the
 * local provider has no direct uploads. Plain http only on loopback.
 */
export function storageUploadSources(id: string | undefined, options: Record<string, unknown> = {}): string[] {
  const origin = (value: unknown): string | null => {
    try {
      const url = new URL(String(value ?? '').trim())
      if (url.protocol === 'https:') return `https://${url.host}`
      if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return `http://${url.host}`
    } catch { /* not a URL */ }
    return null
  }
  if (id === 's3') return [origin(options.endpoint) ?? 'https://*.amazonaws.com']
  if (id === 'azure_blob') {
    const endpoint = origin(options.azure_endpoint)
    if (endpoint) return [endpoint]
    const account = String(options.azure_account_name ?? '').trim() || /AccountName=([^;]+)/i.exec(String(options.azure_connection_string ?? ''))?.[1]
    return [account ? `https://${account}.blob.core.windows.net` : 'https://*.blob.core.windows.net']
  }
  if (id === 'gcs') return [origin(options.gcs_endpoint) ?? 'https://storage.googleapis.com']
  return []
}

export function buildContentSecurityPolicy(opts: { supabaseUrl: string | undefined; isDev: boolean; storagePublicBases?: Record<string, string>; storageUploadSources?: string[] }): string {
  // Stored files: Supabase public URLs (https is already allowed; a loopback
  // http stack — `supabase start` — needs its origin) and direct store URLs.
  const loopbackSupabase = supabaseConnectSources(opts.supabaseUrl).filter((s) => s.startsWith('http://'))
  const media = [...new Set([...loopbackSupabase, ...storageMediaSources(opts.storagePublicBases)])].map((s) => ` ${s}`).join('')
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${opts.isDev ? " 'unsafe-eval'" : ''} blob:`,
    "style-src 'self' 'unsafe-inline' https:",
    `img-src 'self' blob: data: https:${media}`,
    `font-src 'self' data: https:${media}`,
    `connect-src 'self' ${[...new Set([...supabaseConnectSources(opts.supabaseUrl), ...(opts.storageUploadSources ?? [])])].join(' ')}`,
    `media-src 'self' blob: data:${media}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** The policy for the current runtime config (lib/config). */
export function contentSecurityPolicy(): string {
  let storagePublicBases: Record<string, string> | undefined
  let uploadSources: string[] = []
  try {
    const { id, options } = storageConfigSync()
    storagePublicBases = id === 'supabase' || id === 'local' ? undefined : publicBasesFor(options)
    uploadSources = storageUploadSources(id, options)
  } catch {
    storagePublicBases = undefined
  }
  return buildContentSecurityPolicy({
    supabaseUrl: supabaseUrl(),
    isDev: process.env.NODE_ENV === 'development',
    storagePublicBases,
    storageUploadSources: uploadSources,
  })
}
