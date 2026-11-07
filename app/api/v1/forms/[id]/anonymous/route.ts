import { apiRoute } from '@/lib/api/route'
import { getFormAnonymousEndpoint, updateFormAnonymousEndpoint } from '@/lib/api-schemas/anonymous-forms'
import { getFormAnonymousAccess, setFormAnonymousAccess } from '@/lib/services/anonymous-forms'

/** GET /api/v1/forms/{id}/anonymous — the public link, options and warnings. */
export const GET = apiRoute(getFormAnonymousEndpoint, async ({ ctx, params }) => getFormAnonymousAccess(ctx, params.id))

/** PATCH /api/v1/forms/{id}/anonymous — on / off and visitor limits (audited). */
export const PATCH = apiRoute(updateFormAnonymousEndpoint, async ({ ctx, params, body }) => setFormAnonymousAccess(ctx, params.id, body))
