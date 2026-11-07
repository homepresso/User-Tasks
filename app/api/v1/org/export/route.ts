import { apiRoute } from '@/lib/api/route'
import { exportOrgEndpoint } from '@/lib/api-schemas/org'
import { exportOrgCsv } from '@/lib/services/org-import'
import { csvFile } from '@/lib/api/org-route-helpers'

/** GET /api/v1/org/export — `{ csv, filename, rows }`, or the file with format=csv. */
export const GET = apiRoute(exportOrgEndpoint, async ({ ctx, query }) => {
  const result = await exportOrgCsv(ctx)
  return query.format === 'csv' ? csvFile(result.csv, result.filename) : result
})
