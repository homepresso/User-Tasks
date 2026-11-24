import { apiRoute } from '@/lib/api/route'
import { discardAppDraftEndpoint } from '@/lib/api-schemas/apps'
import { discardAppDraft } from '@/lib/services/app-versions'

/** DELETE /api/v1/apps/{id}/draft — discard the draft (back to the published version). */
export const DELETE = apiRoute(discardAppDraftEndpoint, async ({ ctx, params }) => discardAppDraft(ctx, params.id))
