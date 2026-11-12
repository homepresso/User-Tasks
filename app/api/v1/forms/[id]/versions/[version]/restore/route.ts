import { apiRoute } from '@/lib/api/route'
import { restoreFormVersionEndpoint } from '@/lib/api-schemas/forms'
import { restoreFormVersionAsDraft } from '@/lib/services/form-design-drafts'

/** POST /api/v1/forms/{id}/versions/{version}/restore — the version's content becomes the draft. */
export const POST = apiRoute(restoreFormVersionEndpoint, async ({ ctx, params }) => restoreFormVersionAsDraft(ctx, params.id, params.version))
