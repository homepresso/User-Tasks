import { apiRoute } from '@/lib/api/route'
import { getExtensionSettingsEndpoint, updateExtensionSettingsEndpoint } from '@/lib/api-schemas/extensions'
import { getExtensionSettings, updateExtensionSettings } from '@/lib/services/extensions'

/** GET /api/v1/extensions/{id}/settings/{page} — schema and values (secrets never returned). */
export const GET = apiRoute(getExtensionSettingsEndpoint, async ({ ctx, params }) => getExtensionSettings(ctx, params.id, params.page))

/** PUT /api/v1/extensions/{id}/settings/{page} — { values } validated against the schema; audited. */
export const PUT = apiRoute(updateExtensionSettingsEndpoint, async ({ ctx, params, body }) => updateExtensionSettings(ctx, params.id, params.page, body.values))
