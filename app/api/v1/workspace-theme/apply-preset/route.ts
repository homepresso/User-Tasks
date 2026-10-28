import { apiRoute } from '@/lib/api/route'
import { applyWorkspaceThemePresetEndpoint } from '@/lib/api-schemas/workspace-theme'
import { applyWorkspaceThemePreset, presentWorkspaceTheme } from '@/lib/services/workspace-theme'

/** POST /api/v1/workspace-theme/apply-preset */
export const POST = apiRoute(applyWorkspaceThemePresetEndpoint, async ({ ctx, body }) =>
  presentWorkspaceTheme(await applyWorkspaceThemePreset(ctx, body.preset_id, { expectedVersion: body.expected_version })))
