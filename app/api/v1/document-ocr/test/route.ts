import { apiRoute } from '@/lib/api/route'
import { testDocumentOcrEndpoint } from '@/lib/api-schemas/document-ocr'
import { testDocumentOcr } from '@/lib/services/document-ocr'

/** POST /api/v1/document-ocr/test */
export const POST = apiRoute(testDocumentOcrEndpoint, async ({ ctx, body }) => testDocumentOcr(ctx, body ?? {}))
