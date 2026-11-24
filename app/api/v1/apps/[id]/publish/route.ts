import { apiRoute } from '@/lib/api/route'
import { publishAppEndpoint } from '@/lib/api-schemas/apps'
import { publishApp } from '@/lib/services/app-versions'

/** POST /api/v1/apps/{id}/publish — publish the draft as the next version. */
export const POST = apiRoute(publishAppEndpoint, async ({ ctx, params, body }) => publishApp(ctx, params.id, { note: body.note ?? null }))
