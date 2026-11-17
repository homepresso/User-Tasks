import { NextResponse, type NextRequest } from 'next/server'
import { fromSession, requireAny, ServiceError } from '@/lib/services/context'
import { importRouteFailure as failure } from '@/lib/importers/route-errors'

/**
 * POST (JSON): add the columns a Nintex import needs to its extension target
 * (NintexImportHook.createColumns — e.g. a connected SharePoint list; the
 * extension checks the person may change the list). Body: { target,
 * target_config, columns: [{ key, label, kind, choices?, description? }] }.
 * The dialog analyses again afterwards (session cookie auth).
 */

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest, { params }: { params: Promise<{ importer: string }> }) {
  try {
    const { importer } = await params
    if (decodeURIComponent(importer) !== 'nintex') throw ServiceError.notFound('This importer adds no columns')
    const ctx = await fromSession()
    requireAny(ctx, ['workflows.view'])
    let body: Record<string, unknown>
    try { body = await request.json() } catch { throw ServiceError.validation('Expected a JSON body') }
    const { createNintexColumns } = await import('@/lib/importers/nintex/importer')
    return NextResponse.json(await createNintexColumns(ctx, { target: String(body.target ?? ''), target_config: body.target_config, columns: body.columns }), { headers: NO_STORE })
  } catch (error) {
    return failure(error, 'add the columns')
  }
}
