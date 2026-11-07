import { apiRoute } from '@/lib/api/route'
import { deleteProjectEndpoint, getProjectEndpoint, updateProjectEndpoint } from '@/lib/api-schemas/org'
import { deleteProject, getProject, updateProject } from '@/lib/services/projects'

/** GET /api/v1/projects/{id} — the project with its people and teams. */
export const GET = apiRoute(getProjectEndpoint, async ({ ctx, params }) => ({ project: await getProject(ctx, params.id) }))

/** PATCH /api/v1/projects/{id} */
export const PATCH = apiRoute(updateProjectEndpoint, async ({ ctx, params, body }) => ({ project: await updateProject(ctx, params.id, body) }))

/** DELETE /api/v1/projects/{id} */
export const DELETE = apiRoute(deleteProjectEndpoint, async ({ ctx, params }) => deleteProject(ctx, params.id))
