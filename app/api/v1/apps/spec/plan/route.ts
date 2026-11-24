import { apiRoute } from '@/lib/api/route'
import { planAppSpecEndpoint } from '@/lib/api-schemas/apps'
import { planAppSpec } from '@/lib/services/app-spec'

/** POST /api/v1/apps/spec/plan — check an app spec (read-only): errors, warnings, summary. */
export const POST = apiRoute(planAppSpecEndpoint, async ({ ctx, body }) => planAppSpec(ctx, body))
