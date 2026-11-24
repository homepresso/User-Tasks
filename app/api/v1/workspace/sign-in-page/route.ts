import { apiRoute } from '@/lib/api/route'
import { getSignInPageEndpoint, updateSignInPageEndpoint } from '@/lib/api-schemas/form-sign-in-page'
import { getSignInPageSettings, setSignInPageSettings } from '@/lib/services/form-sign-in-page'

/** GET /api/v1/workspace/sign-in-page — the sign-in page for forms and apps (any member). */
export const GET = apiRoute(getSignInPageEndpoint, async ({ ctx }) => getSignInPageSettings(ctx))

/** PATCH /api/v1/workspace/sign-in-page — the settings to change (settings.edit; audited). */
export const PATCH = apiRoute(updateSignInPageEndpoint, async ({ ctx, body }) => setSignInPageSettings(ctx, body))
