import { apiRoute } from '@/lib/api/route'
import { completeTaskAttachmentEndpoint } from '@/lib/api-schemas/task-attachments'
import { apiCompleteTaskAttachment } from '@/lib/services/task-attachments'

/** POST /api/v1/tasks/{id}/attachments/{attachmentId}/complete — finish a direct upload (verified server-side). */
export const POST = apiRoute(completeTaskAttachmentEndpoint, async ({ ctx, params }) => apiCompleteTaskAttachment(ctx, params.id, params.attachmentId))
