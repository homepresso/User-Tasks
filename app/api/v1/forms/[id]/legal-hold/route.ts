import { apiRoute } from '@/lib/api/route'
import { setFormLegalHoldEndpoint } from '@/lib/api-schemas/forms'
import { setFormLegalHold } from '@/lib/services/form-governance'

/** POST /api/v1/forms/{id}/legal-hold — place or release a legal hold (audited). */
export const POST = apiRoute(setFormLegalHoldEndpoint, async ({ ctx, params, body }) =>
  ({ form: await setFormLegalHold(ctx, params.id, { hold: body.hold, reason: body.reason ?? null }) }))
