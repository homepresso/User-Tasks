import { apiRoute } from '@/lib/api/route'
import { runImportEndpoint } from '@/lib/api-schemas/importers'
import { decodeImportFiles, runImport } from '@/lib/services/importers'

export const maxDuration = 60

/** POST /api/v1/importers/{importer}/import */
export const POST = apiRoute(runImportEndpoint, async ({ ctx, params, body }) => runImport(ctx, params.importer, decodeImportFiles(body.files), body.options))
