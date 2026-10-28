import { apiRoute } from '@/lib/api/route'
import { exportDecisionTableEndpoint } from '@/lib/api-schemas/decision-tables'
import { exportDecisionTable } from '@/lib/services/decision-tables'

/** GET /api/v1/decision-tables/{id}/export — portable JSON (POST /decision-tables/import takes it back). */
export const GET = apiRoute(exportDecisionTableEndpoint, async ({ ctx, params }) => exportDecisionTable(ctx, params.id))
