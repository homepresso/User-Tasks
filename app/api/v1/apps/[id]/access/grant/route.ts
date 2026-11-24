import { apiRoute } from '@/lib/api/route'
import { grantAppAccessEndpoint } from '@/lib/api-schemas/apps'
import { grantAppAccess } from '@/lib/services/apps'

/** POST /api/v1/apps/{id}/access/grant — fix access issues with form grants (object permissions, audited). */
export const POST = apiRoute(grantAppAccessEndpoint, async ({ ctx, params, body }) => grantAppAccess(ctx, params.id, body.keys?.length ? body.keys : 'all'))
