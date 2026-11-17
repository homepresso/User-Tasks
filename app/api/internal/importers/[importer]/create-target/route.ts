import { NextResponse, type NextRequest } from 'next/server'
import { fromSession, requireAny, ServiceError } from '@/lib/services/context'
import { importRouteFailure as failure } from '@/lib/importers/route-errors'

/**
 * "Create a <list> for this workflow" for the Nintex import dialog
 * (NintexImportHook.createTargetInfo / createTarget of a usable extension):
 *
 *   GET  ?workflow_id=…   what can be created and where (null: not offered)
 *   POST (JSON)           { extension, name, container, kind, columns,
 *                         if_exists: fail | use, request_id } → the import
 *                         target it makes ({ id, config, title, … }); 409
 *                         code `exists` when the name is taken
 */

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest, { params }: { params: Promise<{ importer: string }> }) {
  try {
    const { importer } = await params
    if (decodeURIComponent(importer) !== 'nintex') throw ServiceError.notFound('This importer creates no targets')
    const ctx = await fromSession()
    requireAny(ctx, ['workflows.view'])
    const { nintexCreateTargetInfo } = await import('@/lib/importers/nintex/importer')
    return NextResponse.json({ info: await nintexCreateTargetInfo(ctx, request.nextUrl.searchParams.get('workflow_id')) }, { headers: NO_STORE })
  } catch (error) {
    return failure(error, 'read what can be created')
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ importer: string }> }) {
  try {
    const { importer } = await params
    if (decodeURIComponent(importer) !== 'nintex') throw ServiceError.notFound('This importer creates no targets')
    const ctx = await fromSession()
    requireAny(ctx, ['workflows.view'])
    let body: Record<string, unknown>
    try { body = await request.json() } catch { throw ServiceError.validation('Expected a JSON body') }
    const extension = String(body.extension ?? '')
    if (!/^[a-z][a-z0-9-]*$/.test(extension)) throw ServiceError.validation('extension is required')
    const { createNintexTarget } = await import('@/lib/importers/nintex/importer')
    return NextResponse.json(await createNintexTarget(ctx, extension, body), { headers: NO_STORE })
  } catch (error) {
    return failure(error, 'create it')
  }
}
