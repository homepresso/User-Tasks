import { apiRoute } from '@/lib/api/route'
import { retryJobEndpoint } from '@/lib/api-schemas/jobs'
import { retryJob } from '@/lib/services/user-jobs'

/** POST /api/v1/jobs/{id}/retry — a new job with the same input. */
export const POST = apiRoute(retryJobEndpoint, async ({ ctx, params }) => ({ job: await retryJob(ctx, params.id) }))
