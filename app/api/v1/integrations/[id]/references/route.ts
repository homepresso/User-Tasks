import { apiRoute } from '@/lib/api/route'
import { createReferenceEndpoint, listIntegrationReferencesEndpoint } from '@/lib/api-schemas/integrations'
import { resolvePage } from '@/lib/services/_shared'
import { createReference, listReferences } from '@/lib/services/references'

/** GET /api/v1/integrations/{id}/references — the integration's references. */
export const GET = apiRoute(listIntegrationReferencesEndpoint, async ({ ctx, params, query }) =>
  listReferences(ctx, { integrationId: params.id, search: query.search }, resolvePage(query)))

/** POST /api/v1/integrations/{id}/references — add a reference. */
export const POST = apiRoute(createReferenceEndpoint, async ({ ctx, params, body }) =>
  ({ reference: await createReference(ctx, params.id, body) }))
