/**
 * Exports leave an audit row (ops QA 2026-11): portable report documents and
 * the report Excel job. (Config export was already audited; the synchronous
 * Excel route is covered in report-export-route.test.ts.)
 */
import { describe, expect, it, vi } from 'vitest'

const audits: Array<Record<string, unknown>> = []
vi.mock('@/lib/audit-log', () => ({ writeAudit: async (p: Record<string, unknown>) => { audits.push(p) } }))

import { exportReport } from '@/lib/services/reports'
import { reportExportJob } from '@/lib/user-jobs/kinds/reports'
import type { ServiceContext } from '@/lib/services/context'

function ctxWith(row: Record<string, unknown> | null): ServiceContext {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder, eq: () => builder, or: () => builder,
    maybeSingle: async () => ({ data: row, error: null }),
    insert: async () => ({ error: null }),
  })
  const supabase = { from: () => builder }
  return { supabase, db: supabase, tenantId: 'tenant-1', actorId: 'user-1', permissions: new Set(['reports.view']), authKind: 'api_key', source: 'api' } as unknown as ServiceContext
}

describe('export audit', () => {
  it('exportReport writes an export row for the report', async () => {
    audits.length = 0
    await exportReport(ctxWith({ name: 'Q3 spend', config: {}, tags: [] }), 'rep-1')
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ tenantId: 'tenant-1', actorId: 'user-1', objectType: 'report', objectId: 'rep-1', action: 'export' })
  })

  it('the report Excel job writes an export row with the row count', async () => {
    audits.length = 0
    const input = new TextEncoder().encode(JSON.stringify({ columns: ['A'], rows: [['x'], ['y']] }))
    await (reportExportJob as any).run({ ctx: ctxWith(null), params: { filename: 'Spend' }, progress: async () => undefined, readInput: async () => input })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ objectType: 'report', action: 'export', metadata: expect.objectContaining({ rows: 2 }) })
  })
})
