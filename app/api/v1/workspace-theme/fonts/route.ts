import { apiRoute } from '@/lib/api/route'
import { uploadWorkspaceThemeFontEndpoint } from '@/lib/api-schemas/workspace-theme'
import { ServiceError } from '@/lib/services/context'
import { uploadWorkspaceThemeFont } from '@/lib/services/workspace-theme'

/** POST /api/v1/workspace-theme/fonts (JSON with base64 content, or multipart/form-data `file`) */
export const POST = apiRoute(uploadWorkspaceThemeFontEndpoint, async ({ ctx, body }) => {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(body.content_base64)) throw ServiceError.validation('content_base64 is not valid base64')
  const bytes = new Uint8Array(Buffer.from(body.content_base64, 'base64'))
  return uploadWorkspaceThemeFont(ctx, { fileName: body.file_name, bytes, family: body.family })
})
