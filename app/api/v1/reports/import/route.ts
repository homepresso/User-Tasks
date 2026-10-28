import { apiRoute } from '@/lib/api/route'
import { importReportEndpoint } from '@/lib/api-schemas/reports'
import { importReport } from '@/lib/services/reports'

/** POST /api/v1/reports/import — create a report from an export document. */
export const POST = apiRoute(importReportEndpoint, async ({ ctx, body }) => {
  const { name_override: nameOverride, ...payload } = body
  return { report: await importReport(ctx, { payload, name_override: nameOverride }) }
})
