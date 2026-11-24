import { apiRoute } from '@/lib/api/route'
import { applyTagsEndpoint } from '@/lib/api-schemas/tags'
import { applyObjectTags } from '@/lib/services/object-tags'

/** POST /api/v1/tags/apply — add / remove tags on objects. */
export const POST = apiRoute(applyTagsEndpoint, async ({ ctx, body }) => applyObjectTags(ctx, body))
