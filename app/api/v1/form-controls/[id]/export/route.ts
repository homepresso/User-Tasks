import { apiRoute } from '@/lib/api/route'
import { exportFormControlEndpoint } from '@/lib/api-schemas/form-controls'
import { exportFormControl } from '@/lib/services/form-controls'

/** GET /api/v1/form-controls/{id}/export — portable JSON (accepted by POST /form-controls/import). */
export const GET = apiRoute(exportFormControlEndpoint, async ({ ctx, params }) => exportFormControl(ctx, params.id))
