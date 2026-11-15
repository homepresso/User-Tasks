import { apiRoute } from '@/lib/api/route'
import { getWorkspaceSsoEndpoint, updateWorkspaceSsoEndpoint } from '@/lib/api-schemas/workspace-sso'
import { getWorkspaceSso, setWorkspaceSso } from '@/lib/services/workspace-sso'

/** GET /api/v1/workspace/sso */
export const GET = apiRoute(getWorkspaceSsoEndpoint, async ({ ctx }) => getWorkspaceSso(ctx))

/** PATCH /api/v1/workspace/sso — { auto_sign_in?, sso_only?, idp? } (settings.edit; audited). */
export const PATCH = apiRoute(updateWorkspaceSsoEndpoint, async ({ ctx, body }) => setWorkspaceSso(ctx, body))
