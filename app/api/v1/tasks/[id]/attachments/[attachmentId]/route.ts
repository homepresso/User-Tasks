import { apiRoute } from '@/lib/api/route'
import { deleteTaskAttachmentEndpoint } from '@/lib/api-schemas/task-attachments'
import { deleteTaskAttachment } from '@/lib/services/task-attachments'

/** DELETE /api/v1/tasks/{id}/attachments/{attachmentId} — soft-delete (uploader or tasks.delete; not under legal hold). */
export const DELETE = apiRoute(deleteTaskAttachmentEndpoint, async ({ ctx, params }) => deleteTaskAttachment(ctx, params.id, params.attachmentId))
