import { apiRoute } from '@/lib/api/route'
import { deleteFormThemeEndpoint, getFormThemeEndpoint, updateFormThemeEndpoint } from '@/lib/api-schemas/forms'
import { deleteFormTheme, getFormTheme, updateFormTheme } from '@/lib/services/forms'

/** GET /api/v1/form-themes/{id} — one saved form theme. */
export const GET = apiRoute(getFormThemeEndpoint, async ({ ctx, params }) =>
  ({ form_theme: await getFormTheme(ctx, params.id) }))

/** PATCH /api/v1/form-themes/{id} — partial update. */
export const PATCH = apiRoute(updateFormThemeEndpoint, async ({ ctx, params, body }) =>
  ({ form_theme: await updateFormTheme(ctx, params.id, body) }))

/** DELETE /api/v1/form-themes/{id} — 409 while a form or step uses the theme. */
export const DELETE = apiRoute(deleteFormThemeEndpoint, async ({ ctx, params }) => deleteFormTheme(ctx, params.id))
