import { apiRoute } from '@/lib/api/route'
import { analyzeImportEndpoint } from '@/lib/api-schemas/importers'
import { analyzeImport, decodeImportFiles } from '@/lib/services/importers'

// Analysing a large export takes a few seconds.
export const maxDuration = 60

/** POST /api/v1/importers/{importer}/analyze */
export const POST = apiRoute(analyzeImportEndpoint, async ({ ctx, params, body }) => analyzeImport(ctx, params.importer, decodeImportFiles(body.files), body.options))
