import { apiRoute } from '@/lib/api/route'
import { deleteObjectEndpoint, getObjectEndpoint, updateObjectEndpoint } from '@/lib/api-schemas/integrations'
import { deleteObject, getObject, updateObject } from '@/lib/services/objects'

/** GET /api/v1/objects/{id} */
export const GET = apiRoute(getObjectEndpoint, async ({ ctx, params }) => ({ object: await getObject(ctx, params.id) }))

/** PATCH /api/v1/objects/{id} — rename, describe, or replace the sources (the GET response is accepted). */
export const PATCH = apiRoute(updateObjectEndpoint, async ({ ctx, params, body }) => {
  const { changed, ...object } = await updateObject(ctx, params.id, body)
  return { object, changed }
})

/** DELETE /api/v1/objects/{id} — also removes its sources and generated references. */
export const DELETE = apiRoute(deleteObjectEndpoint, async ({ ctx, params }) => {
  const { deleted_reference_count } = await deleteObject(ctx, params.id)
  return { deleted: true, deleted_reference_count }
})
