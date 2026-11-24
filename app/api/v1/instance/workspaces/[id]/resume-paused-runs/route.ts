import { apiRoute } from '@/lib/api/route'
import { resumeInstancePausedRunsEndpoint } from '@/lib/api-schemas/instance'
import { clientIp } from '@/lib/scim/tokens'
import { runInstanceAction } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const POST = apiRoute(resumeInstancePausedRunsEndpoint, async ({ ctx, params, body, request }) => ({ result: await runInstanceAction(ctx, 'resume_paused_runs', { ...body, workspace_id: params.id }, { ip: clientIp(request), via: 'api' }) }))
