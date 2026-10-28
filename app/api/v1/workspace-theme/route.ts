import { apiRoute } from '@/lib/api/route'
import { getWorkspaceThemeEndpoint, updateWorkspaceThemeEndpoint } from '@/lib/api-schemas/workspace-theme'
import { getWorkspaceTheme, presentWorkspaceTheme, updateWorkspaceTheme } from '@/lib/services/workspace-theme'

/** GET /api/v1/workspace-theme */
export const GET = apiRoute(getWorkspaceThemeEndpoint, async ({ ctx }) => presentWorkspaceTheme(await getWorkspaceTheme(ctx)))

/** PUT /api/v1/workspace-theme */
export const PUT = apiRoute(updateWorkspaceThemeEndpoint, async ({ ctx, body }) => {
  const { expected_version: expectedVersion, ...theme } = body
  return presentWorkspaceTheme(await updateWorkspaceTheme(ctx, theme, { expectedVersion }))
})
