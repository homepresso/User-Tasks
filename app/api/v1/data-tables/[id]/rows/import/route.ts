import { apiRoute } from '@/lib/api/route'
import { importRowsEndpoint } from '@/lib/api-schemas/data-tables'
import { importRowsHandler } from '@/lib/user-jobs/kinds/api'

/**
 * POST /api/v1/data-tables/{id}/rows/import — CSV / TSV / .xlsx (JSON with
 * file_base64, or multipart `file`); dry_run validates only. Async variant
 * (?async=true / Prefer: respond-async): 202 with a job that writes in
 * resumable batches (required above 5,000 rows).
 */
export const POST = apiRoute(importRowsEndpoint, importRowsHandler)
