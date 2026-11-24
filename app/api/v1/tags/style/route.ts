import { apiRoute } from '@/lib/api/route'
import { deleteTagStyleEndpoint, setTagStyleEndpoint } from '@/lib/api-schemas/tags'
import { deleteTagStyle, setTagStyle } from '@/lib/services/tags'

/** PUT /api/v1/tags/style — a tag's colour / description. */
export const PUT = apiRoute(setTagStyleEndpoint, async ({ ctx, body }) => ({ tag: await setTagStyle(ctx, body) }))

/** DELETE /api/v1/tags/style?name= — back to the automatic colour. */
export const DELETE = apiRoute(deleteTagStyleEndpoint, async ({ ctx, query }) => deleteTagStyle(ctx, query.name))
