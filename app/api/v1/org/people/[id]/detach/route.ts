import { apiRoute } from '@/lib/api/route'
import { detachOrgPersonEndpoint } from '@/lib/api-schemas/org'
import { detachPersonProfile } from '@/lib/services/org'

/** POST /api/v1/org/people/{id}/detach — attributes stop following the directory. */
export const POST = apiRoute(detachOrgPersonEndpoint, async ({ ctx, params }) => detachPersonProfile(ctx, params.id))
