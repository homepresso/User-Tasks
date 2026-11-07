import { apiRoute } from '@/lib/api/route'
import { getTaskCompletionSettingsEndpoint, updateTaskCompletionSettingsEndpoint } from '@/lib/api-schemas/task-completion'
import { getTaskCompletionSettings, setTaskCompletionSettings } from '@/lib/services/task-completion-screen'

/** GET /api/v1/workspace/task-completion */
export const GET = apiRoute(getTaskCompletionSettingsEndpoint, async ({ ctx }) => getTaskCompletionSettings(ctx))

/** PATCH /api/v1/workspace/task-completion — the settings to change (settings.edit; audited). */
export const PATCH = apiRoute(updateTaskCompletionSettingsEndpoint, async ({ ctx, body }) => setTaskCompletionSettings(ctx, body))
