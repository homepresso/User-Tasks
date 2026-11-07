import { apiRoute } from '@/lib/api/route'
import { addTaskAttachmentEndpoint, listTaskAttachmentsEndpoint } from '@/lib/api-schemas/task-attachments'
import { apiAddTaskAttachment, listTaskAttachments } from '@/lib/services/task-attachments'

/** GET /api/v1/tasks/{id}/attachments — the task's attachments. */
export const GET = apiRoute(listTaskAttachmentsEndpoint, async ({ ctx, params }) => listTaskAttachments(ctx, params.id))

/** POST /api/v1/tasks/{id}/attachments — attach a file (base64), or start a direct upload. */
export const POST = apiRoute(addTaskAttachmentEndpoint, async ({ ctx, params, body }) => apiAddTaskAttachment(ctx, params.id, body))
