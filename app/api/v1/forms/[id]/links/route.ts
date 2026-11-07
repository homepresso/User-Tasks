import { apiRoute } from '@/lib/api/route'
import { getFormLinksEndpoint } from '@/lib/api-schemas/forms'
import { getFormLinks } from '@/lib/services/form-links'

/** GET /api/v1/forms/{id}/links — friendly link, form page and public link. */
export const GET = apiRoute(getFormLinksEndpoint, async ({ ctx, params }) => getFormLinks(ctx, params.id))
