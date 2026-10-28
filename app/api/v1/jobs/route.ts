import { apiRoute } from '@/lib/api/route'
import { listJobsEndpoint } from '@/lib/api-schemas/jobs'
import { listJobs } from '@/lib/services/user-jobs'
import type { UserJobStatus } from '@/lib/user-jobs/types'

/** GET /api/v1/jobs — background jobs of this credential's user (or key). */
export const GET = apiRoute(listJobsEndpoint, async ({ ctx, query }) => listJobs(ctx, {
  scope: query.scope,
  active: query.active === 'true',
  status: query.status?.split(',').map((s) => s.trim()).filter(Boolean) as UserJobStatus[] | undefined,
  limit: query.limit,
}))
