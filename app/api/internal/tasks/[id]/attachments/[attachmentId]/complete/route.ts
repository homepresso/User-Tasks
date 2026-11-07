import { NextResponse, type NextRequest } from 'next/server'
import { apiCompleteTaskAttachment } from '@/lib/services/task-attachments'
import { attachmentRouteError, NO_STORE, taskAttachmentSession } from '@/lib/services/task-attachments-session'

/**
 * Finish a direct-to-storage upload: the uploader only, within the upload
 * window. The server reads the object back and verifies it before it is
 * listed; a file that fails is deleted.
 */

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const { id, attachmentId } = await params
    const ctx = await taskAttachmentSession(id)
    return NextResponse.json(await apiCompleteTaskAttachment(ctx, id, attachmentId), { status: 201, headers: NO_STORE })
  } catch (error) {
    return attachmentRouteError(error, 'complete')
  }
}
