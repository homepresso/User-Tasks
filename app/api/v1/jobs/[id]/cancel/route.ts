import { apiRoute } from '@/lib/api/route'
import { cancelJobEndpoint } from '@/lib/api-schemas/jobs'
import { cancelJob } from '@/lib/services/user-jobs'

/** POST /api/v1/jobs/{id}/cancel */
export const POST = apiRoute(cancelJobEndpoint, async ({ ctx, params }) => ({ job: await cancelJob(ctx, params.id) }))
