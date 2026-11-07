import { NextResponse, type NextRequest } from 'next/server'
import { ServiceError } from '@/lib/services/context'
import { addTaskAttachment, listTaskAttachments } from '@/lib/services/task-attachments'
import { attachmentRouteError, NO_STORE, taskAttachmentSession } from '@/lib/services/task-attachments-session'

/**
 * The task screen's Attachments tab (session cookie auth, the task's own
 * workspace):
 *
 *   GET   the task's attachments + what the caller may do
 *   POST  multipart/form-data — file, name, type, description, size: one
 *         file through the app (small files, providers without signed
 *         uploads). Larger files go straight to storage (./init, the
 *         browser's PUT, ./<id>/complete).
 *
 * Authorisation, limits and content checks: lib/services/task-attachments.ts.
 */

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params
    const ctx = await taskAttachmentSession(id)
    return NextResponse.json(await listTaskAttachments(ctx, id), { headers: NO_STORE })
  } catch (error) {
    return attachmentRouteError(error, 'list')
  }
}

function text(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 415, headers: NO_STORE })
  }
  try {
    const { id } = await params
    const ctx = await taskAttachmentSession(id)
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw ServiceError.validation('The upload could not be read — try again')
    }
    const file = form.get('file')
    if (!file || typeof file === 'string') throw ServiceError.validation('No file was sent')
    const declared = text(form, 'size')
    const attachment = await addTaskAttachment(ctx, {
      task_id: id,
      name: text(form, 'name'),
      type: text(form, 'type'),
      description: text(form, 'description'),
      file_name: file.name || 'file',
      bytes: new Uint8Array(await file.arrayBuffer()),
      declared_size: /^\d+$/.test(declared) ? Number(declared) : null,
    })
    return NextResponse.json({ attachment }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return attachmentRouteError(error, 'upload')
  }
}
