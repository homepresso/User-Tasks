import { apiRoute } from '@/lib/api/route'
import { getJobEndpoint } from '@/lib/api-schemas/jobs'
import { getJob } from '@/lib/services/user-jobs'

/** GET /api/v1/jobs/{id} */
export const GET = apiRoute(getJobEndpoint, async ({ ctx, params }) => ({ job: await getJob(ctx, params.id) }))
