import { isPreviewableImage } from '@/lib/forms/attachments'
import { signedObjectQuery, verifyFilesSignature } from '@/lib/storage/signing'
import type { StorageObject } from '@/lib/providers/storage/types'
import type { ServiceContext } from './context'
import { FORM_FILES_BUCKET, type FormFileRow } from './form-files'

/**
 * GET /attachments/<id> (app/attachments/[id]/route.ts): an uploaded form
 * file, never public.
 *
 *  1. Signed in: the caller must be a member of the file's workspace and
 *     pass authorizeFileDownload (uploader; the task's people; the
 *     submission's submitter; forms.edit / tasks.view_all). Then a 302 to the
 *     same URL with a signature valid for SIGNED_TTL_SECONDS (5 minutes) —
 *     the short-lived link the browser downloads from (or the file streamed
 *     at once where the instance has no signing key).
 *  2. Signed URL: served while the signature is valid, without a session.
 *  3. Not signed in: browsers go to the sign-in page and come back; other
 *     clients get 401. Anything not allowed is 404, so ids don't leak.
 *
 * Responses: `Content-Disposition: attachment` (inline only for PNG / JPEG /
 * GIF / WebP thumbnails asked for with `?inline=1`), the verified MIME type,
 * nosniff, a sandboxing CSP, no caching outside the browser.
 */

export const SIGNED_TTL_SECONDS = 300

const SANDBOX_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"

export interface FormFileDownloadDeps {
  load: (id: string) => Promise<FormFileRow | null>
  /** The signed-in caller acting in `tenantId`; null = not signed in; throws (forbidden) when not a member. */
  session: (tenantId: string) => Promise<ServiceContext | null>
  authorize: (ctx: ServiceContext, row: FormFileRow) => Promise<boolean>
  open: (row: FormFileRow) => Promise<StorageObject | null>
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } })
}

export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

async function stream(request: Request, row: FormFileRow, deps: FormFileDownloadDeps, inline: boolean): Promise<Response> {
  const object = await deps.open(row)
  if (!object) return notFound()
  const showInline = inline && isPreviewableImage(row.mime_type)
  const headers = new Headers({
    'Content-Type': row.mime_type || 'application/octet-stream',
    'Content-Disposition': contentDisposition(row.name, showInline),
    'Content-Security-Policy': SANDBOX_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
  })
  if (object.size) headers.set('Content-Length', String(object.size))
  if (request.method === 'HEAD') {
    await object.body.cancel().catch(() => {})
    return new Response(null, { status: 200, headers })
  }
  return new Response(object.body, { status: 200, headers })
}

export async function serveFormFileDownload(request: Request, id: string, deps: FormFileDownloadDeps): Promise<Response> {
  const url = new URL(request.url)
  const inline = url.searchParams.get('inline') === '1'
  const row = await deps.load(id)
  if (!row || (row.status !== 'pending' && row.status !== 'bound')) return notFound()

  const expires = url.searchParams.get('expires')
  const signature = url.searchParams.get('signature')
  if (expires || signature) {
    if (!verifyFilesSignature(FORM_FILES_BUCKET, row.id, expires, signature)) return notFound()
    return stream(request, row, deps, inline)
  }

  let ctx: ServiceContext | null
  try {
    ctx = await deps.session(row.tenant_id)
  } catch {
    return notFound()
  }
  if (!ctx) {
    const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html')
    if (wantsHtml) {
      const back = `${url.pathname}${inline ? '?inline=1' : ''}`
      return new Response(null, { status: 302, headers: { Location: `/login?redirect=${encodeURIComponent(back)}`, 'Cache-Control': 'no-store' } })
    }
    return new Response('Sign in to download this file', { status: 401, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  if (!(await deps.authorize(ctx, row))) return notFound()

  const query = signedObjectQuery(FORM_FILES_BUCKET, row.id, SIGNED_TTL_SECONDS)
  if (!query) return stream(request, row, deps, inline)
  return new Response(null, {
    status: 302,
    headers: { Location: `${url.pathname}?${query}${inline ? '&inline=1' : ''}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}
