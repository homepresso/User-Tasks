import { apiRoute } from '@/lib/api/route'
import { getFormGovernanceEndpoint } from '@/lib/api-schemas/forms'
import { getFormGovernance } from '@/lib/services/form-governance'

/** GET /api/v1/forms/{id}/governance — retention policy, legal hold and submission count. */
export const GET = apiRoute(getFormGovernanceEndpoint, async ({ ctx, params }) => ({ governance: await getFormGovernance(ctx, params.id) }))
