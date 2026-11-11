import { NextResponse, type NextRequest } from 'next/server'
import { fromSession, isServiceError, ServiceError } from '@/lib/services/context'
import { INFOPATH_UPLOAD_MAX_BYTES } from '@/lib/infopath/archive'
import { analyzeInfoPathFile, importInfoPathFile, type InfoPathImportOptions } from '@/lib/services/infopath-import'

/**
 * The Forms page's InfoPath importer (session cookie auth, multipart/form-data):
 *
 *   file      the .xsn (or a .zip of its source files)
 *   action    analyze (default) | import
 *   options   JSON: { mode, views, name, tag, existing, create_table, available_in_menu }
 *
 * The browser sends the file again with the chosen options to import (the
 * server keeps nothing between the two requests). Uploads are capped at
 * INFOPATH_UPLOAD_MAX_BYTES (4 MB): serverless request bodies stop at about
 * 4.5 MB. Bigger templates: zip just the source files, or use the REST API /
 * CLI on a self-hosted instance (20 MB).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 415, headers: NO_STORE })
  }
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > INFOPATH_UPLOAD_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'The file is larger than 4 MB. Zip only the form\'s source files (Export Source Files in InfoPath Designer) and upload the .zip.' }, { status: 413, headers: NO_STORE })
  }
  try {
    const ctx = await fromSession()
    let form: FormData
    try { form = await request.formData() } catch { throw ServiceError.validation('The upload could not be read — try again') }
    const file = form.get('file')
    if (!file || typeof file === 'string') throw ServiceError.validation('No file was sent')
    if (file.size > INFOPATH_UPLOAD_MAX_BYTES) throw ServiceError.validation('The file is larger than 4 MB. Zip only the form\'s source files and upload the .zip.')
    let options: InfoPathImportOptions = {}
    const raw = form.get('options')
    if (typeof raw === 'string' && raw.trim()) {
      try { options = JSON.parse(raw) } catch { throw ServiceError.validation('options must be JSON') }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const action = form.get('action') === 'import' ? 'import' : 'analyze'
    const result = action === 'import'
      ? await importInfoPathFile(ctx, bytes, file.name || 'form.xsn', options)
      : await analyzeInfoPathFile(ctx, bytes, file.name || 'form.xsn', options, { definitions: true })
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[forms.infopath]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'The InfoPath file could not be imported — try again' }, { status: 500, headers: NO_STORE })
  }
}
