import { apiRoute } from '@/lib/api/route'
import { deleteDocumentOcrKeyEndpoint, getDocumentOcrEndpoint, updateDocumentOcrEndpoint } from '@/lib/api-schemas/document-ocr'
import { getDocumentOcr, removeDocumentOcrKey, updateDocumentOcr } from '@/lib/services/document-ocr'

/** GET /api/v1/document-ocr */
export const GET = apiRoute(getDocumentOcrEndpoint, async ({ ctx }) => getDocumentOcr(ctx))

/** PUT /api/v1/document-ocr */
export const PUT = apiRoute(updateDocumentOcrEndpoint, async ({ ctx, body }) => updateDocumentOcr(ctx, body))

/** DELETE /api/v1/document-ocr */
export const DELETE = apiRoute(deleteDocumentOcrKeyEndpoint, async ({ ctx }) => removeDocumentOcrKey(ctx))
