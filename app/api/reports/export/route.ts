import { NextRequest, NextResponse } from 'next/server'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { getUserPermissions } from '@/lib/permissions-server'

/**
 * Excel export for report tables, synchronous. The report Export button now
 * runs the same build as a background job (`report.export`,
 * lib/user-jobs/kinds/reports.ts); this route stays for existing callers.
 * The browser posts the rows it is showing (already flattened to column
 * label → value) and gets an .xlsx back. Session auth + reports.view; the
 * rows are the caller's own data, nothing is read from the database here.
 */

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 20 * 2 ** 20
const MAX_ROWS = 100_000
const MAX_COLUMNS = 200

function safeFilename(raw: unknown): string {
  const name = String(raw ?? '').replace(/[^\w.\- ]+/g, '').trim().slice(0, 100)
  return name || 'report'
}


export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const perms = await getUserPermissions()
  if (!perms.has('reports.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Export too large' }, { status: 413 })
  let body: { filename?: unknown; columns?: unknown; rows?: unknown }
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Export too large' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const columns = Array.isArray(body.columns) ? body.columns.map((c) => String(c ?? '')) : null
  const rows = Array.isArray(body.rows) ? body.rows : null
  if (!columns || columns.length === 0 || columns.length > MAX_COLUMNS || !rows || rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `columns (1-${MAX_COLUMNS}) and rows (up to ${MAX_ROWS}) are required` }, { status: 400 })
  }

  // Array-of-arrays keeps column order and duplicate labels intact.
  const { buildReportWorkbook } = await import('@/lib/user-jobs/kinds/reports')
  const buffer = await buildReportWorkbook(columns, rows)
  const xl = await import('@/lib/excel')

  const filename = safeFilename(body.filename)
  return new NextResponse(buffer as Uint8Array<ArrayBuffer>, {
    headers: {
      'Content-Type': xl.EXCEL_MIME,
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
