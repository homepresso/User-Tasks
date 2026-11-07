import { apiRoute } from '@/lib/api/route'
import { attachProjectTeamEndpoint, detachProjectTeamEndpoint } from '@/lib/api-schemas/org'
import { attachProjectTeam, detachProjectTeam } from '@/lib/services/projects'

/** PUT /api/v1/projects/{id}/teams/{teamId} — attach a whole team (idempotent). */
export const PUT = apiRoute(attachProjectTeamEndpoint, async ({ ctx, params }) => attachProjectTeam(ctx, params.id, params.teamId))

/** DELETE /api/v1/projects/{id}/teams/{teamId} */
export const DELETE = apiRoute(detachProjectTeamEndpoint, async ({ ctx, params }) => detachProjectTeam(ctx, params.id, params.teamId))
