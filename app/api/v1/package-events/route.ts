import { apiRoute } from '@/lib/api/route'
import { listPackageEventsEndpoint } from '@/lib/api-schemas/packages'
import { resolvePage } from '@/lib/services/_shared'
import { listPackageEvents } from '@/lib/services/package-events'

/** GET /api/v1/package-events — package history */
export const GET = apiRoute(listPackageEventsEndpoint, async ({ ctx, query }) => {
  const { limit, offset, ...filters } = query
  return listPackageEvents(ctx, filters, resolvePage({ limit, offset }))
})
