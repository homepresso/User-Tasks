import { apiRoute } from '@/lib/api/route'
import { getOrgPersonEndpoint, updateOrgPersonEndpoint } from '@/lib/api-schemas/org'
import { getPerson, updatePersonProfile } from '@/lib/services/org'

/** GET /api/v1/org/people/{id} — one person in context. */
export const GET = apiRoute(getOrgPersonEndpoint, async ({ ctx, params }) => getPerson(ctx, params.id))

/** PATCH /api/v1/org/people/{id} — attributes and/or manager. */
export const PATCH = apiRoute(updateOrgPersonEndpoint, async ({ ctx, params, body }) => updatePersonProfile(ctx, params.id, body))
