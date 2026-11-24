import { apiRoute } from '@/lib/api/route'
import { listAppWidgetTypesEndpoint } from '@/lib/api-schemas/apps'
import { listWidgetTypes } from '@/lib/services/apps'

/** GET /api/v1/apps/widget-types — the widget catalogue with config schemas. */
export const GET = apiRoute(listAppWidgetTypesEndpoint, async () => {
  const widget_types = listWidgetTypes()
  return { widget_types, total: widget_types.length }
})
