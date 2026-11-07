import { apiRoute } from '@/lib/api/route'
import { addProjectMemberEndpoint, removeProjectMemberEndpoint } from '@/lib/api-schemas/org'
import { addProjectMember, removeProjectMember } from '@/lib/services/projects'

/** PUT /api/v1/projects/{id}/members/{userId} — add or update (idempotent). */
export const PUT = apiRoute(addProjectMemberEndpoint, async ({ ctx, params, body }) =>
  addProjectMember(ctx, params.id, params.userId, { role: body.role, allocation_percent: body.allocation_percent }))

/** DELETE /api/v1/projects/{id}/members/{userId} */
export const DELETE = apiRoute(removeProjectMemberEndpoint, async ({ ctx, params }) => removeProjectMember(ctx, params.id, params.userId))
