import { z } from 'zod'
import { requirePerm, ServiceError } from '@/lib/services/context'
import { defineJobKind } from '../define'

/*
 * Report table → Excel (components/reports/report-export.tsx). The browser
 * sends the rows it shows (already flattened to column label → value) as the
 * job input, as it posted them to /api/reports/export; building the workbook
 * runs in the job. reports.view, as before.
 */

export const MAX_REPORT_ROWS = 100_000
export const MAX_REPORT_COLUMNS = 200

type Cell = string | number | boolean | null

function cell(value: unknown): Cell {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

export function reportFileName(raw: unknown): string {
  const name = String(raw ?? '').replace(/[^\w.\- ]+/g, '').trim().slice(0, 100)
  return name || 'report'
}

/** Header + rows as an .xlsx (shared with the synchronous /api/reports/export). */
export async function buildReportWorkbook(columns: string[], rows: unknown[]): Promise<Uint8Array> {
  const sheetRows: Cell[][] = [columns, ...rows.map((row) => (Array.isArray(row) ? row : []).slice(0, columns.length).map(cell))]
  const xl = await import('@/lib/excel')
  return new Uint8Array(await xl.workbookToBuffer(xl.buildWorkbook([{ name: 'Report', arrays: sheetRows }])))
}

export const reportExportJob = defineJobKind({
  kind: 'report.export',
  effect: 'download',
  maxAttempts: 2,
  input: { maxBytes: 20 * 1024 * 1024 },
  params: z.object({ filename: z.string().max(200).default('report') }),
  title: (p) => `Excel export “${reportFileName(p.filename)}”`,
  authorize: (ctx) => requirePerm(ctx, 'reports.view'),
  async run({ params, progress, readInput }) {
    const input = await readInput()
    if (!input) throw ServiceError.validation('The report rows are missing')
    let body: { columns?: unknown; rows?: unknown }
    try {
      body = JSON.parse(new TextDecoder().decode(input))
    } catch {
      throw ServiceError.validation('Invalid report rows')
    }
    const columns = Array.isArray(body.columns) ? body.columns.map((c) => String(c ?? '')) : null
    const rows = Array.isArray(body.rows) ? body.rows : null
    if (!columns || columns.length === 0 || columns.length > MAX_REPORT_COLUMNS || !rows || rows.length > MAX_REPORT_ROWS) {
      throw ServiceError.validation(`columns (1-${MAX_REPORT_COLUMNS}) and rows (up to ${MAX_REPORT_ROWS}) are required`)
    }
    await progress(20, `Building the workbook (${rows.length.toLocaleString('en')} rows)`)
    const bytes = await buildReportWorkbook(columns, rows)
    return {
      file: { name: `${reportFileName(params.filename)}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: bytes },
      counts: { rows: rows.length },
      summary: `${rows.length.toLocaleString('en')} row${rows.length === 1 ? '' : 's'}`,
    }
  },
})
