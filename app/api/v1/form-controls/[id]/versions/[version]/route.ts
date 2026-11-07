import { apiRoute } from '@/lib/api/route'
import { getFormControlVersionEndpoint } from '@/lib/api-schemas/form-controls'
import { getFormControlVersion } from '@/lib/services/form-controls'

/** GET /api/v1/form-controls/{id}/versions/{version} — manifest, checksum (and the module with include_module=true). */
export const GET = apiRoute(getFormControlVersionEndpoint, async ({ ctx, params, query }) =>
  ({ version: (await getFormControlVersion(ctx, params.id, params.version, { includeBundle: query.include_module === 'true' })).version }))
