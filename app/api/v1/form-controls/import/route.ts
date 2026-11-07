import { apiRoute } from '@/lib/api/route'
import { importFormControlEndpoint } from '@/lib/api-schemas/form-controls'
import { importFormControl } from '@/lib/services/form-controls'

/** POST /api/v1/form-controls/import — import a portable export. */
export const POST = apiRoute(importFormControlEndpoint, async ({ ctx, body }) => importFormControl(ctx, body))
