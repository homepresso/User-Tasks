import { apiRoute } from '@/lib/api/route'
import { listImportersEndpoint } from '@/lib/api-schemas/importers'
import { listImporterViews } from '@/lib/services/importers'

/** GET /api/v1/importers */
export const GET = apiRoute(listImportersEndpoint, async ({ ctx, query }) => listImporterViews(ctx, { produces: query?.produces }))
