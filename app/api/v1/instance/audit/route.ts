import { apiRoute } from '@/lib/api/route'
import { listInstanceAuditEndpoint } from '@/lib/api-schemas/instance'
import { readInstanceDataset } from '@/lib/services/instance-admin'

/** Instance admin (cloud admin) API: instance admins only (404 for everyone else); see lib/api-schemas/instance.ts. */
export const GET = apiRoute(listInstanceAuditEndpoint, async ({ ctx, query }) => readInstanceDataset(ctx, 'audit', query, { via: 'api' }))
