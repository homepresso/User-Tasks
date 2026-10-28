import { apiRoute } from '@/lib/api/route'
import { executeReferenceEndpoint } from '@/lib/api-schemas/integrations'
import { executeReference } from '@/lib/services/references'

/** POST /api/v1/references/{id}/execute — call the reference (egress-guarded, logged to integration calls). */
export const POST = apiRoute(executeReferenceEndpoint, async ({ ctx, params, body }) =>
  executeReference(ctx, params.id, body.inputs, { captureSchema: body.capture_schema === true }))
