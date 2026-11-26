/**
 * Request body size cap for JSON APIs (/api/v1 through lib/api/route.ts, and
 * /api/mcp).
 *
 * Without one, an authenticated caller could send a body as large as the
 * platform allows (next.config proxyClientMaxBodySize: 50 MB self-hosted) and
 * have it parsed and validated in full — a memory-exhaustion vector (one
 * validation issue per element of an oversized array). API_MAX_BODY_BYTES
 * sets the cap (bytes; default 5 MiB). Larger files go through
 * multipart/form-data where an endpoint accepts it, or a signed upload URL.
 */

export const DEFAULT_API_MAX_BODY_BYTES = 5 * 1024 * 1024

/** The configured cap: API_MAX_BODY_BYTES when a positive integer, else 5 MiB. Read per call (runtime env). */
export function apiMaxBodyBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.API_MAX_BODY_BYTES)
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_API_MAX_BODY_BYTES
}

/**
 * The cap for endpoints whose JSON body carries base64 packages or large
 * documents and that have no multipart alternative (importer files, portable
 * control / activity exports, OpenAPI documents, data-table import files
 * the CLI sends as base64): API_MAX_PACKAGE_BODY_BYTES
 * when a positive integer, else 50 MB (the effective limit before the cap).
 */
export const DEFAULT_API_MAX_PACKAGE_BODY_BYTES = 50 * 1024 * 1024

export function apiMaxPackageBodyBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.API_MAX_PACKAGE_BODY_BYTES)
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_API_MAX_PACKAGE_BODY_BYTES
}

/** "5 MB" / "512 KB" / "100 bytes" for error messages. */
export function formatBodyLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

/**
 * The 413 message: what the cap is, which setting raises it, and the way
 * round it where the endpoint has one (multipart upload).
 */
export function bodyTooLargeMessage(limit: number, opts: { tier: 'default' | 'package'; multipart: boolean }): string {
  const size = formatBodyLimit(limit)
  const setting = opts.tier === 'package' ? 'API_MAX_PACKAGE_BODY_BYTES' : 'API_MAX_BODY_BYTES'
  const hint = opts.multipart ? `; use multipart upload (multipart/form-data, the \`file\` field) for files over ${size}` : ''
  return `Request body is larger than ${size} (${setting})${hint}`
}

/**
 * MCP tools whose arguments carry base64 packages or large documents (the
 * /api/v1 endpoints behind them have bodyLimit 'package'): a tools/call to one
 * of these may use API_MAX_PACKAGE_BODY_BYTES; every other MCP message keeps
 * API_MAX_BODY_BYTES.
 */
export const MCP_PACKAGE_TOOLS: ReadonlySet<string> = new Set([
  'importers_analyze', 'importers_import',
  'packages_inspect', 'packages_install_plan', 'packages_install', 'packages_upgrade',
  'form_controls_create', 'form_controls_import',
  'workflow_activities_upload', 'workflow_activities_import',
  'integrations_import_api_spec',
  // Data-table import: the CLI and MCP send the file as base64 JSON (the importer's own cap, 10 MB of file, still applies).
  'data_rows_import',
])

/** Cheap pre-check on the raw text before parsing an over-default-size body: names a package tool at all. */
export function mentionsMcpPackageTool(text: string): boolean {
  for (const name of MCP_PACKAGE_TOOLS) if (text.includes(`"${name}"`)) return true
  return false
}

/** Whether a parsed JSON-RPC message (or batch) only calls package tools. */
export function isMcpPackageCall(message: unknown): boolean {
  const calls = Array.isArray(message) ? message : [message]
  return calls.length > 0 && calls.every((m) => {
    const call = m as { method?: unknown; params?: { name?: unknown } } | null
    return call?.method === 'tools/call' && typeof call.params?.name === 'string' && MCP_PACKAGE_TOOLS.has(call.params.name)
  })
}

export type CappedBody = { ok: true; text: string; size: number } | { ok: false; reason: 'too_large' | 'unreadable' }

/**
 * Read the request body as UTF-8 text, at most `maxBytes`. A declared
 * Content-Length over the cap is refused before reading; otherwise the stream
 * is read until it passes the cap, then cancelled (a chunked or lying client
 * cannot make the server buffer more than the cap).
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<CappedBody> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' }
  if (!request.body) return { ok: true, text: '', size: 0 }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { ok: true, text: new TextDecoder().decode(bytes), size }
}
