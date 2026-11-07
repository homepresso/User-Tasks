/**
 * Serving custom form controls to the browser:
 *
 *   GET /form-controls/frame/<tag>/<version>[?task=<id>|?w=<workspace>]
 *     the sandboxed frame document (lib/forms/custom-controls/frame.ts)
 *     with its own CSP — for the signed-in member's workspace (the task's
 *     workspace when `task` is given, as the unified view spans several);
 *   GET /form-controls/bundle/<tag>/<version>.js
 *     the module itself, ONLY for controls an instance admin marked
 *     trusted (rendered inline in the page under the app's CSP).
 *
 * Cross-workspace access is refused: a control is read with the workspace
 * filter of the caller's own membership. Disabled controls don't load.
 */

import { createHash } from 'node:crypto'
import { buildFrameDocument, FRAME_HEADERS, frameContentSecurityPolicy, frameErrorDocument } from '@/lib/forms/custom-controls/frame'
import { fromSession, isServiceError, ServiceError, type ServiceContext } from './context'
import { loadControlForFrame } from './form-controls'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The caller's context for a frame request: the task's workspace, an explicit workspace, or their current one. */
export async function frameContext(params: URLSearchParams): Promise<ServiceContext> {
  const task = params.get('task')
  const workspace = params.get('w')
  if (task && UUID_RE.test(task)) {
    const session = await fromSession()
    // RLS: only tasks the user can see; then act in that task's workspace (membership re-checked).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tasks row read through the session client
    const { data } = await (session.supabase as any).from('tasks').select('tenant_id').eq('id', task).maybeSingle()
    if (data?.tenant_id && data.tenant_id !== session.tenantId) return fromSession({ tenantId: String(data.tenant_id) })
    return session
  }
  if (workspace && UUID_RE.test(workspace)) return fromSession({ tenantId: workspace })
  return fromSession()
}

function errorStatus(error: unknown): { status: number; message: string } {
  if (isServiceError(error)) return { status: error.status, message: error.status >= 500 ? 'This control could not be loaded' : error.message }
  console.error('[form-controls.frame]', error)
  return { status: 500, message: 'This control could not be loaded' }
}

const ERROR_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox; base-uri 'none'; form-action 'none'"

function errorResponse(error: unknown): Response {
  const { status, message } = errorStatus(error)
  return new Response(frameErrorDocument(message), {
    status,
    headers: { ...FRAME_HEADERS, 'Cache-Control': 'no-store', 'Content-Security-Policy': ERROR_CSP },
  })
}

/**
 * Built frame documents (the module inlined, its CSP hashes), per immutable
 * control version: a form with several controls, or the same form opened
 * again, no longer re-serialises and re-hashes modules of up to 2 MB. The
 * access checks (membership, disabled, approved hosts) still run on every
 * request — only the pure build is reused.
 */
const builtDocuments = new Map<string, { html: string; hashes: string[] }>()
const BUILT_DOCUMENTS_MAX = 64

export function builtFrameDocument(manifest: Parameters<typeof buildFrameDocument>[0], bundle: string, bundleSha: string): { html: string; hashes: string[] } {
  const key = `${manifest.tag}@${manifest.version}#${bundleSha}`
  const hit = builtDocuments.get(key)
  if (hit) { builtDocuments.delete(key); builtDocuments.set(key, hit); return hit }
  const { html, scripts } = buildFrameDocument(manifest, bundle)
  const built = { html, hashes: scripts.map((s) => createHash('sha256').update(s, 'utf8').digest('base64')) }
  builtDocuments.set(key, built)
  while (builtDocuments.size > BUILT_DOCUMENTS_MAX) builtDocuments.delete(builtDocuments.keys().next().value as string)
  return built
}

/** Strong validator: the module, the runtime and the CSP inputs (approved hosts change the document's headers). */
export function frameETag(bundleSha: string, hashes: string[], approvedHosts: readonly string[]): string {
  const digest = createHash('sha256').update(`${bundleSha}|${hashes.join(',')}|${[...approvedHosts].sort().join(',')}`).digest('hex').slice(0, 40)
  return `"${digest}"`
}

function matchesETag(request: Request, etag: string): boolean {
  const header = request.headers.get('if-none-match')
  return Boolean(header && header.split(',').some((t) => t.trim().replace(/^W\//, '') === etag))
}

/** The frame document response. */
/**
 * A public form link's frame (`?p=<token>`, no session): the link must resolve
 * (lib/services/anonymous-forms.ts) and its form must use this control version.
 * The control runs with no capabilities: no approved hosts (network), and the
 * host refuses its lookup / files / reports requests (custom-control-field).
 */
async function anonymousFrameContext(token: string, tag: string, version: string): Promise<ServiceContext> {
  const svc = await import('./anonymous-forms')
  const resolved = await svc.resolveAnonymousForm(token)
  if (!resolved) throw ServiceError.notFound('Form control not found')
  const ctx = await svc.anonymousContext(resolved, { ip: 'frame' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forms is read untyped
  const { data: form } = await (ctx.supabase as any).from('forms').select('fields').eq('id', resolved.formId).eq('tenant_id', resolved.tenantId).maybeSingle()
  const fields = Array.isArray(form?.fields) ? form.fields as Array<{ type?: string; custom?: { tag?: string; version?: string } }> : []
  if (!fields.some((f) => f?.type === 'custom' && f.custom?.tag === tag && f.custom?.version === version)) throw ServiceError.notFound('Form control not found')
  return ctx
}

export async function serveControlFrame(request: Request, tag: string, version: string): Promise<Response> {
  try {
    const search = new URL(request.url).searchParams
    const token = search.get('p')
    const ctx = token ? await anonymousFrameContext(token, tag, version) : await frameContext(search)
    const raw = await loadControlForFrame(ctx, tag, version)
    const loaded = token ? { ...raw, approvedHosts: [] as string[] } : raw
    const { html, hashes } = builtFrameDocument(loaded.manifest, loaded.bundle, loaded.sha256)
    const etag = frameETag(loaded.sha256, hashes, loaded.approvedHosts)
    const headers = {
      ...FRAME_HEADERS,
      'Content-Security-Policy': frameContentSecurityPolicy({ scriptHashes: hashes, approvedHosts: loaded.approvedHosts }),
      ETag: etag,
    }
    // Revalidation after max-age: same access checks above, then no body when nothing changed.
    if (matchesETag(request, etag)) return new Response(null, { status: 304, headers })
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers })
  } catch (error) {
    return errorResponse(error)
  }
}

/** A trusted control's module (inline rendering). */
export async function serveTrustedBundle(request: Request, tag: string, file: string): Promise<Response> {
  const version = file.replace(/\.js$/, '')
  try {
    const ctx = await frameContext(new URL(request.url).searchParams)
    const loaded = await loadControlForFrame(ctx, tag, version)
    if (!loaded.control.trusted) throw ServiceError.forbidden('This control is not trusted for inline rendering')
    return new Response(request.method === 'HEAD' ? null : loaded.bundle, {
      status: 200,
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
        'Cross-Origin-Resource-Policy': 'same-origin',
        ETag: `"${loaded.sha256}"`,
      },
    })
  } catch (error) {
    const { status, message } = errorStatus(error)
    return new Response(`/* ${message.replace(/\*\//g, '')} */`, { status, headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }
}
