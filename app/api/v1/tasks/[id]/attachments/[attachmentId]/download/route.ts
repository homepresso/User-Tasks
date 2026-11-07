import { apiRoute } from '@/lib/api/route'
import { taskAttachmentDownloadEndpoint } from '@/lib/api-schemas/task-attachments'
import { taskAttachmentDownloadUrl } from '@/lib/services/task-attachments'

/** GET /api/v1/tasks/{id}/attachments/{attachmentId}/download — a 5-minute signed link (audited). */
export const GET = apiRoute(taskAttachmentDownloadEndpoint, async ({ ctx, params }) => taskAttachmentDownloadUrl(ctx, params.id, params.attachmentId))
