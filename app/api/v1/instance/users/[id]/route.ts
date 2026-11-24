import { apiRoute } from '@/lib/api/route'
import { getInstanceUserEndpoint } from '@/lib/api-schemas/instance'
import { readInstanceDataset } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const GET = apiRoute(getInstanceUserEndpoint, async ({ ctx, params }) => ({ user: (await readInstanceDataset(ctx, 'user', { user_id: params.id }, { via: 'api' })).rows[0] }))
