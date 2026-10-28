import { apiRoute } from '@/lib/api/route'
import { deleteReferenceEndpoint, getReferenceEndpoint, updateReferenceEndpoint } from '@/lib/api-schemas/integrations'
import { deleteReference, getReference, updateReference } from '@/lib/services/references'

/** GET /api/v1/references/{id} */
export const GET = apiRoute(getReferenceEndpoint, async ({ ctx, params }) =>
  ({ reference: await getReference(ctx, params.id) }))

/** PATCH /api/v1/references/{id} — partial update. */
export const PATCH = apiRoute(updateReferenceEndpoint, async ({ ctx, params, body }) =>
  ({ reference: await updateReference(ctx, params.id, body) }))

/** DELETE /api/v1/references/{id} */
export const DELETE = apiRoute(deleteReferenceEndpoint, async ({ ctx, params }) => {
  await deleteReference(ctx, params.id)
  return { deleted: true }
})
