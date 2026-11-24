import { apiRoute } from '@/lib/api/route'
import { applyAppSpecEndpoint } from '@/lib/api-schemas/apps'
import { applyAppSpec } from '@/lib/services/app-spec'

/** POST /api/v1/apps/spec/apply — build or change an app from a spec, whole or not at all. */
export const POST = apiRoute(applyAppSpecEndpoint, async ({ ctx, body }) => applyAppSpec(ctx, body))
