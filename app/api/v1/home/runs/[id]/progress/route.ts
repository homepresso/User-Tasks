import { apiRoute } from '@/lib/api/route'
import { getRunProgressEndpoint } from '@/lib/api-schemas/home'
import { getRunProgress } from '@/lib/services/home'

/** GET /api/v1/home/runs/{id}/progress — the submitter-safe progress of a run. */
export const GET = apiRoute(getRunProgressEndpoint, async ({ ctx, params }) => ({ progress: await getRunProgress(ctx, params.id) }))
