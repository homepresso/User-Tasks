import { apiRoute } from '@/lib/api/route'
import { createIntegrationEndpoint, listIntegrationsEndpoint } from '@/lib/api-schemas/integrations'
import { resolvePage } from '@/lib/services/_shared'
import { createIntegration, listIntegrations } from '@/lib/services/integrations'

/** GET /api/v1/integrations — list integrations (no config). */
export const GET = apiRoute(listIntegrationsEndpoint, async ({ ctx, query }) =>
  listIntegrations(ctx, {
    active: query.active === undefined ? undefined : query.active === 'true',
    type: query.type,
    search: query.search,
  }, resolvePage(query)))

/** POST /api/v1/integrations — create an integration (credentials encrypted at rest). */
export const POST = apiRoute(createIntegrationEndpoint, async ({ ctx, body }) =>
  ({ integration: await createIntegration(ctx, body) }))
