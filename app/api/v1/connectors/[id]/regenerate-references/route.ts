import { apiRoute } from '@/lib/api/route'
import { regenerateConnectorReferencesEndpoint } from '@/lib/api-schemas/integrations'
import { regenerateConnectorReferences } from '@/lib/services/connectors'

/** POST /api/v1/connectors/{id}/regenerate-references — rebuild references from the template. */
export const POST = apiRoute(regenerateConnectorReferencesEndpoint, async ({ ctx, params }) =>
  regenerateConnectorReferences(ctx, params.id))
