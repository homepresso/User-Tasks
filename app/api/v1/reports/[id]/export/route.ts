import { apiRoute } from '@/lib/api/route'
import { exportReportEndpoint } from '@/lib/api-schemas/reports'
import { exportReport } from '@/lib/services/reports'

/** GET /api/v1/reports/{id}/export — portable report document. */
export const GET = apiRoute(exportReportEndpoint, async ({ ctx, params }) => exportReport(ctx, params.id))
