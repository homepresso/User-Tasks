import { apiRoute } from '@/lib/api/route'
import { getAppSpecReferenceEndpoint } from '@/lib/api-schemas/apps'
import { appSpecReference } from '@/lib/services/app-spec'

/** GET /api/v1/apps/spec/reference — the app spec format, design guide, templates and an example. */
export const GET = apiRoute(getAppSpecReferenceEndpoint, async ({ query }) => appSpecReference((query.widget_types ?? '').split(',').map((t) => t.trim()).filter(Boolean)))
