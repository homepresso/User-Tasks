import { apiRoute } from '@/lib/api/route'
import { createFormThemeEndpoint, listFormThemesEndpoint } from '@/lib/api-schemas/forms'
import { resolvePage } from '@/lib/services/_shared'
import { createFormTheme, listFormThemes } from '@/lib/services/forms'

/** GET /api/v1/form-themes — saved form themes. */
export const GET = apiRoute(listFormThemesEndpoint, async ({ ctx, query }) =>
  listFormThemes(ctx, { search: query.search }, resolvePage(query)))

/** POST /api/v1/form-themes — create a saved form theme. */
export const POST = apiRoute(createFormThemeEndpoint, async ({ ctx, body }) =>
  ({ form_theme: await createFormTheme(ctx, body) }))
