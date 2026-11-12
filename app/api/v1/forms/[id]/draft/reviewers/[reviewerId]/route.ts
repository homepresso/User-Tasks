import { apiRoute } from '@/lib/api/route'
import { removeFormDraftReviewerEndpoint } from '@/lib/api-schemas/forms'
import { removeDraftReviewer } from '@/lib/services/form-design-drafts'

/** DELETE /api/v1/forms/{id}/draft/reviewers/{reviewerId} — stop sharing the draft with one reviewer. */
export const DELETE = apiRoute(removeFormDraftReviewerEndpoint, async ({ ctx, params }) => removeDraftReviewer(ctx, params.id, { id: params.reviewerId }))
