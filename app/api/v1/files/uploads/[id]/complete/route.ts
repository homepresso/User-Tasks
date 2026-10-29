import { apiRoute } from '@/lib/api/route'
import { completeFileUploadEndpoint } from '@/lib/api-schemas/files'
import { completeDirectUpload } from '@/lib/services/form-files'

/** POST /api/v1/files/uploads/{id}/complete — verify a direct upload and make it usable. */
export const POST = apiRoute(completeFileUploadEndpoint, async ({ ctx, params }) => ({ file: await completeDirectUpload(ctx, params.id) }))
