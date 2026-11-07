import { apiRoute } from '@/lib/api/route'
import { followRunEndpoint, unfollowRunEndpoint } from '@/lib/api-schemas/home'
import { setRunFollowed } from '@/lib/services/home'

/** PUT /api/v1/home/following/{id} — follow a run. */
export const PUT = apiRoute(followRunEndpoint, async ({ ctx, params }) => setRunFollowed(ctx, params.id, true))

/** DELETE /api/v1/home/following/{id} — unfollow a run. */
export const DELETE = apiRoute(unfollowRunEndpoint, async ({ ctx, params }) => setRunFollowed(ctx, params.id, false))
