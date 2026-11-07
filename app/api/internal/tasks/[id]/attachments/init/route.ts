import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { initTaskAttachmentUpload } from '@/lib/services/task-attachments'
import { attachmentRouteError, NO_STORE, taskAttachmentSession } from '@/lib/services/task-attachments-session'

/**
 * Start a direct-to-storage upload of one task attachment (session, JSON):
 * a signed PUT URL for exactly one object and the attachment id to
 * complete, or `{ mode: "server" }` when the storage provider can't sign
 * uploads (send the file to ../ instead).
 */

export const dynamic = 'force-dynamic'

const Body = z.object({
  file_name: z.string().min(1).max(1000),
  size: z.number().int().positive(),
  name: z.string().max(1000).optional(),
  type: z.string().max(1000).optional(),
  description: z.string().max(10_000).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
  }
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  try {
    const { id } = await params
    const ctx = await taskAttachmentSession(id)
    const result = await initTaskAttachmentUpload(ctx, { ...parsed.data, task_id: id })
    return NextResponse.json(result, { status: result.mode === 'direct' ? 201 : 200, headers: NO_STORE })
  } catch (error) {
    return attachmentRouteError(error, 'init')
  }
}
