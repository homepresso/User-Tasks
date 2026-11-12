import { apiRoute } from '@/lib/api/route'
import { compareFormDraftEndpoint } from '@/lib/api-schemas/forms'
import { compareDesignDraft } from '@/lib/services/form-design-drafts'

/** GET /api/v1/forms/{id}/draft/compare — what the draft changes against the published version. */
export const GET = apiRoute(compareFormDraftEndpoint, async ({ ctx, params }) => compareDesignDraft(ctx, params.id))
