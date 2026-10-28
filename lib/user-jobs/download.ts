import { isServiceError } from '@/lib/services/context'
import type { JobDownload } from '@/lib/services/user-jobs'

/**
 * HTTP response for a job's result file (session route /api/jobs/<id>/download
 * and GET /api/v1/jobs/{id}/download): always an attachment, never cached,
 * sandboxed like /files, so a stored HTML/SVG result cannot run in the app's
 * origin. Access is checked on every request (owner, not expired) — there is
 * no long-lived URL to leak.
 */
const SANDBOX_CSP = "default-src 'none'; sandbox"

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export function jobDownloadResponse(file: JobDownload): Response {
  const headers = new Headers({
    'Content-Type': file.contentType,
    'Content-Disposition': contentDisposition(file.filename),
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': SANDBOX_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
  if (file.size) headers.set('Content-Length', String(file.size))
  return new Response(file.body, { status: 200, headers })
}

export function jobDownloadError(error: unknown): Response {
  const status = isServiceError(error) ? error.status : 500
  const message = isServiceError(error) ? error.message : 'Download failed'
  if (!isServiceError(error)) console.error('[user-jobs] download failed:', error)
  return Response.json({ success: false, error: message, ...(isServiceError(error) ? { code: error.code } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } })
}
