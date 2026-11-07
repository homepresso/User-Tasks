import { apiRoute } from '@/lib/api/route'
import { regenerateFormAnonymousEndpoint } from '@/lib/api-schemas/anonymous-forms'
import { regenerateFormAnonymousToken } from '@/lib/services/anonymous-forms'

/** POST /api/v1/forms/{id}/anonymous/regenerate — a new public link; earlier ones stop working (audited). */
export const POST = apiRoute(regenerateFormAnonymousEndpoint, async ({ ctx, params }) => regenerateFormAnonymousToken(ctx, params.id))
