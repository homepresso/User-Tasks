import { apiRoute } from '@/lib/api/route'
import { getAppObjectDetailsEndpoint } from '@/lib/api-schemas/apps'
import { describeAppObject } from '@/lib/services/app-spec'

/** GET /api/v1/apps/spec/object — a form's fields and parameters, a table's columns, a workflow's trigger. */
export const GET = apiRoute(getAppObjectDetailsEndpoint, async ({ ctx, query }) => describeAppObject(ctx, query))
