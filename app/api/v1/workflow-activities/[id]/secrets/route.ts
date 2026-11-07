import { apiRoute } from '@/lib/api/route'
import { setWorkflowActivitySecretsEndpoint } from '@/lib/api-schemas/workflow-activities'
import { setWorkflowActivitySecrets } from '@/lib/services/workflow-activities'

/** PUT /api/v1/workflow-activities/{id}/secrets — set / clear declared secrets (encrypted, never returned). */
export const PUT = apiRoute(setWorkflowActivitySecretsEndpoint, async ({ ctx, params, body }) =>
  setWorkflowActivitySecrets(ctx, params.id, body.values))
