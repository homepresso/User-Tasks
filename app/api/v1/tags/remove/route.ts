import { apiRoute } from '@/lib/api/route'
import { removeTagEndpoint } from '@/lib/api-schemas/tags'
import { removeTag } from '@/lib/services/tags'

/** POST /api/v1/tags/remove — remove a tag from every object. */
export const POST = apiRoute(removeTagEndpoint, async ({ ctx, body }) => removeTag(ctx, body))
