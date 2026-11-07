import { apiRoute } from '@/lib/api/route'
import { getOrgImportTemplateEndpoint } from '@/lib/api-schemas/org'
import { orgCsvTemplate } from '@/lib/services/org-import'
import { csvFile } from '@/lib/api/org-route-helpers'

const FILENAME = 'org-import-template.csv'

/** GET /api/v1/org/import/template — the CSV template. */
export const GET = apiRoute(getOrgImportTemplateEndpoint, async ({ query }) => {
  const csv = orgCsvTemplate()
  return query.format === 'csv' ? csvFile(csv, FILENAME) : { csv, filename: FILENAME }
})
