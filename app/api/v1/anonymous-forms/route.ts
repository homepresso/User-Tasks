import { apiRoute } from '@/lib/api/route'
import { getAnonymousWorkspaceEndpoint, updateAnonymousWorkspaceEndpoint } from '@/lib/api-schemas/anonymous-forms'
import { getAnonymousWorkspaceSettings, setAnonymousWorkspaceSettings } from '@/lib/services/anonymous-forms'

/** GET /api/v1/anonymous-forms — the workspace switch and bot protection (never the secret). */
export const GET = apiRoute(getAnonymousWorkspaceEndpoint, async ({ ctx }) => getAnonymousWorkspaceSettings(ctx))

/** PATCH /api/v1/anonymous-forms — the workspace switch and bot protection (settings.edit, audited). */
export const PATCH = apiRoute(updateAnonymousWorkspaceEndpoint, async ({ ctx, body }) => setAnonymousWorkspaceSettings(ctx, body))
