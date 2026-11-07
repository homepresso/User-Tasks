import { apiRoute } from '@/lib/api/route'
import { archiveProjectEndpoint } from '@/lib/api-schemas/org'
import { archiveProject } from '@/lib/services/projects'

/** POST /api/v1/projects/{id}/archive — archive, or restore with archived=false. */
export const POST = apiRoute(archiveProjectEndpoint, async ({ ctx, params, body }) => ({ project: await archiveProject(ctx, params.id, body.archived !== false) }))
