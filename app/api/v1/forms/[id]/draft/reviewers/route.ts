import { apiRoute } from '@/lib/api/route'
import { addFormDraftReviewersEndpoint, listFormDraftReviewersEndpoint } from '@/lib/api-schemas/forms'
import { addDraftReviewers, listDraftReviewers } from '@/lib/services/form-design-drafts'

/** GET /api/v1/forms/{id}/draft/reviewers — who the draft is shared with. */
export const GET = apiRoute(listFormDraftReviewersEndpoint, async ({ ctx, params }) => listDraftReviewers(ctx, params.id))

/** POST /api/v1/forms/{id}/draft/reviewers — share the draft (read-only preview; they are notified). */
export const POST = apiRoute(addFormDraftReviewersEndpoint, async ({ ctx, params, body }) =>
  addDraftReviewers(ctx, params.id, { principals: body.reviewers, note: body.note ?? null }))
