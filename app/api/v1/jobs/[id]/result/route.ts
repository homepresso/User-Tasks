import { apiRoute } from '@/lib/api/route'
import { getJobResultEndpoint } from '@/lib/api-schemas/jobs'
import { getJobResult } from '@/lib/services/user-jobs'

/** GET /api/v1/jobs/{id}/result — what the synchronous request would have returned. */
export const GET = apiRoute(getJobResultEndpoint, async ({ ctx, params }) => getJobResult(ctx, params.id))
