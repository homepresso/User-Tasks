import { apiRoute } from '@/lib/api/route'
import { discardFormDraftEndpoint, getFormDraftEndpoint, saveFormDraftEndpoint } from '@/lib/api-schemas/forms'
import { discardDesignDraft, getDesignDraft, saveDesignDraft } from '@/lib/services/form-design-drafts'

/** GET /api/v1/forms/{id}/draft — the working draft (null when none), who saved it, publish problems. */
export const GET = apiRoute(getFormDraftEndpoint, async ({ ctx, params }) => getDesignDraft(ctx, params.id))

/** PUT /api/v1/forms/{id}/draft — save the draft (mode live: no drafts on this server, published directly). */
export const PUT = apiRoute(saveFormDraftEndpoint, async ({ ctx, params, body }) => saveDesignDraft(ctx, params.id, body))

/** DELETE /api/v1/forms/{id}/draft — discard the draft. */
export const DELETE = apiRoute(discardFormDraftEndpoint, async ({ ctx, params }) => discardDesignDraft(ctx, params.id))
