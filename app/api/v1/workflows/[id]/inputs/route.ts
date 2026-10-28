import { apiRoute } from '@/lib/api/route'
import { getWorkflowInputsEndpoint } from '@/lib/api-schemas/workflows'
import { getWorkflowInputs } from '@/lib/services/workflow-start'

/** GET /api/v1/workflows/{id}/inputs — the input parameters a start accepts (published version, else draft). */
export const GET = apiRoute(getWorkflowInputsEndpoint, async ({ ctx, params }) => getWorkflowInputs(ctx, params.id))
