import { apiRoute } from '@/lib/api/route'
import { publishFormDraftEndpoint } from '@/lib/api-schemas/forms'
import { publishDesignDraft } from '@/lib/services/form-design-drafts'

/** POST /api/v1/forms/{id}/publish — publish the draft as a new version (blocked with the problems). */
export const POST = apiRoute(publishFormDraftEndpoint, async ({ ctx, params, body }) => publishDesignDraft(ctx, params.id, { note: body.note ?? null }))
