import { apiRoute } from '@/lib/api/route'
import { createProjectEndpoint, listProjectsEndpoint } from '@/lib/api-schemas/org'
import { createProject, listProjects } from '@/lib/services/projects'
import type { ProjectStatus } from '@/lib/org/structure'

/** GET /api/v1/projects */
export const GET = apiRoute(listProjectsEndpoint, async ({ ctx, query }) => listProjects(ctx, {
  status: query.status ? query.status.split(',').map((s) => s.trim()).filter(Boolean) as ProjectStatus[] : null,
  include_archived: query.include_archived === 'true',
  team_id: query.team_id ?? null,
  org_unit_id: query.org_unit_id ?? null,
  q: query.q ?? null,
}))

/** POST /api/v1/projects */
export const POST = apiRoute(createProjectEndpoint, async ({ ctx, body }) => ({ project: await createProject(ctx, body) }))
