import { NextResponse, type NextRequest } from 'next/server'
import { cancelTaskAttachmentUpload, deleteTaskAttachment } from '@/lib/services/task-attachments'
import { attachmentRouteError, NO_STORE, taskAttachmentSession } from '@/lib/services/task-attachments-session'

/**
 * DELETE: soft-delete an attachment (its uploader, or tasks.delete; not
 * while the task's form is on legal hold). `?upload=1` abandons a direct
 * upload that never completed (the uploader only).
 */

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const { id, attachmentId } = await params
    const ctx = await taskAttachmentSession(id)
    const result = new URL(request.url).searchParams.get('upload') === '1'
      ? await cancelTaskAttachmentUpload(ctx, attachmentId)
      : await deleteTaskAttachment(ctx, id, attachmentId)
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    return attachmentRouteError(error, 'delete')
  }
}
