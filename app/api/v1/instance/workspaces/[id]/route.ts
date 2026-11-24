import { apiRoute } from '@/lib/api/route'
import { getInstanceWorkspaceEndpoint } from '@/lib/api-schemas/instance'
import { readInstanceDataset } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const GET = apiRoute(getInstanceWorkspaceEndpoint, async ({ ctx, params }) => ({ workspace: (await readInstanceDataset(ctx, 'workspace', { workspace_id: params.id }, { via: 'api' })).rows[0] }))
