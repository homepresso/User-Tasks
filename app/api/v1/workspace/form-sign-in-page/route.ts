import { apiRoute } from '@/lib/api/route'
import { getFormSignInPageEndpoint, updateFormSignInPageEndpoint } from '@/lib/api-schemas/form-sign-in-page'
import { getFormSignInSettings, setFormSignInSettings } from '@/lib/services/form-sign-in-page'

/** GET /api/v1/workspace/form-sign-in-page */
export const GET = apiRoute(getFormSignInPageEndpoint, async ({ ctx }) => getFormSignInSettings(ctx))

/** PATCH /api/v1/workspace/form-sign-in-page — the settings to change (settings.edit; audited). */
export const PATCH = apiRoute(updateFormSignInPageEndpoint, async ({ ctx, body }) => setFormSignInSettings(ctx, body))
