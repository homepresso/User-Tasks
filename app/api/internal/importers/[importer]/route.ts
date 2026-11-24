import { NextResponse, type NextRequest } from 'next/server'
import { fromSession, isServiceError, ServiceError } from '@/lib/services/context'
import { analyzeImport, IMPORT_LIMITS, runImport } from '@/lib/services/importers'
import type { ImportFile } from '@/lib/extensions/sdk'

/**
 * The Import dialogs' upload (session cookie auth, multipart/form-data):
 *
 *   file      one or more files (repeated field)
 *   action    analyze (default) | import
 *   options   JSON: the importer's options
 *
 * The browser sends the files again to import (nothing is kept between the
 * two requests). Bounded by IMPORT_MAX_MB (default 20 MB); hosted
 * (serverless) request bodies stop at about 4.5 MB.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest, { params }: { params: Promise<{ importer: string }> }) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 415, headers: NO_STORE })
  }
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > IMPORT_LIMITS.maxTotalBytes + 256 * 1024) {
    return NextResponse.json({ error: `The files are larger than ${Math.round(IMPORT_LIMITS.maxTotalBytes / 1024 / 1024)} MB together` }, { status: 413, headers: NO_STORE })
  }
  try {
    const { importer } = await params
    const ctx = await fromSession()
    let form: FormData
    try { form = await request.formData() } catch { throw ServiceError.validation('The upload could not be read — try again') }
    const files: ImportFile[] = []
    for (const entry of form.getAll('file')) {
      if (typeof entry === 'string') continue
      files.push({ name: entry.name || 'file', bytes: new Uint8Array(await entry.arrayBuffer()), contentType: entry.type || null })
    }
    let options: Record<string, unknown> = {}
    const raw = form.get('options')
    if (typeof raw === 'string' && raw.trim()) {
      try { options = JSON.parse(raw) } catch { throw ServiceError.validation('options must be JSON') }
    }
    const result = form.get('action') === 'import'
      ? await runImport(ctx, decodeURIComponent(importer), files, options)
      : await analyzeImport(ctx, decodeURIComponent(importer), files, options)
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code, details: error.details ?? null }, { status: error.status, headers: NO_STORE })
    console.error('[importers]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'The import failed — try again' }, { status: 500, headers: NO_STORE })
  }
}

/**
 * GET pdf: the PDF importer's AI assist availability ({ ai }).
 * GET nintex: the core Nintex importer's targets for "Where should this go?" (new,
 * replace, and the targets of usable extensions with their fields); with
 * ?workflow_id= also `bound`: the target that workflow is bound to.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ importer: string }> }) {
  try {
    const { importer } = await params
    // The PDF importer: whether "Use AI for the hard parts" can be offered here (and the provider it would use).
    if (decodeURIComponent(importer) === 'pdf') {
      const ctx = await fromSession()
      const { requireAny } = await import('@/lib/services/context')
      requireAny(ctx, ['forms.view', 'forms.edit'])
      const { pdfAiAvailability } = await import('@/lib/importers/pdf/importer')
      return NextResponse.json({ ai: await pdfAiAvailability(ctx) }, { headers: NO_STORE })
    }
    if (decodeURIComponent(importer) !== 'nintex') throw ServiceError.notFound('This importer has no targets')
    const ctx = await fromSession()
    const { requireAny } = await import('@/lib/services/context')
    requireAny(ctx, ['workflows.view', 'forms.view'])
    const { boundNintexTarget, listNintexTargets } = await import('@/lib/importers/nintex/importer')
    // ?workflow_id=…: the target that workflow is bound to (the designer's "Connect to this list").
    const workflowId = request.nextUrl.searchParams.get('workflow_id')
    const [targets, bound] = await Promise.all([listNintexTargets(ctx), workflowId ? boundNintexTarget(ctx, workflowId) : Promise.resolve(null)])
    return NextResponse.json({ targets, bound }, { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[importers] targets', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not list the targets' }, { status: 500, headers: NO_STORE })
  }
}
