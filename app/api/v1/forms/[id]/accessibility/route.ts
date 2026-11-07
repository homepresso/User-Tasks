import { apiRoute } from '@/lib/api/route'
import { checkFormAccessibilityEndpoint } from '@/lib/api-schemas/forms'
import { checkFormAccessibilityFor } from '@/lib/services/form-accessibility'

/** POST /api/v1/forms/{id}/accessibility — WCAG 2.2 AA check of a reusable form (or an unsaved definition of it). */
export const POST = apiRoute(checkFormAccessibilityEndpoint, async ({ ctx, params, body }) =>
  checkFormAccessibilityFor(ctx, params.id, { definition: body?.definition ?? null }))
