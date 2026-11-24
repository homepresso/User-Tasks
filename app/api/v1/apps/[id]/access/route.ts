import { apiRoute } from '@/lib/api/route'
import { getAppAccessEndpoint } from '@/lib/api-schemas/apps'
import { getAppAccessAnalysis } from '@/lib/services/apps'

/** GET /api/v1/apps/{id}/access — access issues (audience × objects the app uses). */
export const GET = apiRoute(getAppAccessEndpoint, async ({ ctx, params }) => getAppAccessAnalysis(ctx, params.id))
