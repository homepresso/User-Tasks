import { apiRoute } from '@/lib/api/route'
import { claimTaskEndpoint } from '@/lib/api-schemas/home'
import { claimTask } from '@/lib/services/home'

/** POST /api/v1/tasks/{id}/claim — claim an unassigned team task. */
export const POST = apiRoute(claimTaskEndpoint, async ({ ctx, params }) => claimTask(ctx, params.id))
