import { apiRoute } from '@/lib/api/route'
import { importOrgEndpoint } from '@/lib/api-schemas/org'
import { applyOrgCsvImport, planOrgCsvImport, type OrgImportMapping } from '@/lib/services/org-import'

/** POST /api/v1/org/import — dry run (default) or apply a CSV import. */
export const POST = apiRoute(importOrgEndpoint, async ({ ctx, body }) => {
  const input = { csv: body.csv, mapping: body.mapping as OrgImportMapping | undefined }
  return body.dry_run === false ? applyOrgCsvImport(ctx, input) : { dry_run: true, ...(await planOrgCsvImport(ctx, input)) }
})
