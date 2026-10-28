import { apiRoute } from '@/lib/api/route'
import { listWorkspaceThemePresetsEndpoint } from '@/lib/api-schemas/workspace-theme'
import { listWorkspaceThemePresets } from '@/lib/services/workspace-theme'

/** GET /api/v1/workspace-theme/presets */
export const GET = apiRoute(listWorkspaceThemePresetsEndpoint, async () => listWorkspaceThemePresets())
