import { apiRoute } from '@/lib/api/route'
import { listAuditLogEndpoint } from '@/lib/api-schemas/governance'
import { resolvePage } from '@/lib/services/_shared'
import { listAuditLog } from '@/lib/services/audit-log'

/** GET /api/v1/audit-log — object audit log, newest first. */
export const GET = apiRoute(listAuditLogEndpoint, async ({ ctx, query }) => listAuditLog(ctx, {
  object_type: query.object_type, object_id: query.object_id, actor_id: query.actor_id,
  action: query.action, from: query.from, to: query.to,
}, resolvePage(query)))
