import { apiRoute } from '@/lib/api/route'
import { listInstanceAssetsEndpoint } from '@/lib/api-schemas/instance'
import { readInstanceDataset } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const GET = apiRoute(listInstanceAssetsEndpoint, async ({ ctx, query }) => readInstanceDataset(ctx, 'assets', query, { via: 'api' }))
