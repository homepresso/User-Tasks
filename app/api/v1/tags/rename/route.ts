import { apiRoute } from '@/lib/api/route'
import { renameTagEndpoint } from '@/lib/api-schemas/tags'
import { renameTag } from '@/lib/services/tags'

/** POST /api/v1/tags/rename — rename or merge a tag on every object. */
export const POST = apiRoute(renameTagEndpoint, async ({ ctx, body }) => renameTag(ctx, body))
