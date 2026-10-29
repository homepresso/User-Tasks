import { apiRoute } from '@/lib/api/route'
import { uploadFileEndpoint } from '@/lib/api-schemas/files'
import { apiUploadFile } from '@/lib/services/form-files'

/** POST /api/v1/files/uploads — upload a file for an Attachments field, or start a direct upload. */
export const POST = apiRoute(uploadFileEndpoint, async ({ ctx, body }) => apiUploadFile(ctx, body))
