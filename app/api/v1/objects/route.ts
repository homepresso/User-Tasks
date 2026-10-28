import { apiRoute } from '@/lib/api/route'
import { createObjectEndpoint, listObjectsEndpoint } from '@/lib/api-schemas/integrations'
import { resolvePage } from '@/lib/services/_shared'
import { createObject, listObjects } from '@/lib/services/objects'

/** GET /api/v1/objects — composite objects with their sources. */
export const GET = apiRoute(listObjectsEndpoint, async ({ ctx, query }) => listObjects(ctx, resolvePage(query)))

/** POST /api/v1/objects — create a composite object and its generated reference. */
export const POST = apiRoute(createObjectEndpoint, async ({ ctx, body }) => createObject(ctx, body))
