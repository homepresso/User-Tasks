import { apiRoute } from '@/lib/api/route'
import { testIntegrationEndpoint } from '@/lib/api-schemas/integrations'
import { testIntegration } from '@/lib/services/integrations'

/** POST /api/v1/integrations/{id}/test — connection test; the outcome is recorded on the integration. */
export const POST = apiRoute(testIntegrationEndpoint, async ({ ctx, params }) => {
  const { status, message, http_status } = await testIntegration(ctx, params.id)
  return { status, message, http_status }
})
