import { NextResponse, type NextRequest } from 'next/server'
import { isServiceError, ServiceError } from '@/lib/services/context'
import { uploadFormFile } from '@/lib/services/form-files'
import { uploadSession } from '@/lib/services/form-files-session'

/**
 * Upload one file into an Attachments field (multipart/form-data, session
 * cookie auth; the browser sends one request per file so it can show
 * progress, cancel and retry each).
 *
 *   file        the file
 *   field_key   the Attachments field
 *   task_id | form_id | workflow_id   where the form is filled in: an open
 *               task (its own workspace — the unified view spans several),
 *               a reusable form's page / start form, or a designer test run
 *   size        the size the browser sent (a cut-short body is refused)
 *
 * Everything else — authorisation, the field's limits, content checks,
 * storage — is lib/services/form-files.ts. The response is the file object
 * the field's value holds (pending until the form is submitted).
 *
 * Files over 4 MB go straight to storage instead (./init, the browser's PUT
 * to a signed URL, ./complete): serverless request bodies are capped at a
 * few MB. This path stays for small files and for providers without signed
 * uploads (local disk).
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function fail(error: unknown) {
  if (isServiceError(error)) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
  }
  console.error('[forms.files]', error)
  return NextResponse.json({ error: 'The upload failed — try again' }, { status: 500, headers: NO_STORE })
}

function text(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 415, headers: NO_STORE })
  }
  try {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw ServiceError.validation('The upload could not be read — try again')
    }
    const file = form.get('file')
    if (!file || typeof file === 'string') throw ServiceError.validation('No file was sent')
    const fieldKey = text(form, 'field_key')
    if (!fieldKey) throw ServiceError.validation('field_key is required')
    const taskId = text(form, 'task_id')
    const formId = text(form, 'form_id')
    const workflowId = text(form, 'workflow_id')
    const startWorkflowId = text(form, 'start_workflow_id')
    const declared = text(form, 'size')

    const { ctx, context } = await uploadSession({ task_id: taskId || undefined, form_id: formId || undefined, workflow_id: workflowId || undefined, start_workflow_id: startWorkflowId || undefined })

    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await uploadFormFile(ctx, {
      context,
      field_key: fieldKey,
      name: file.name || 'file',
      bytes,
      declared_size: declared && /^\d+$/.test(declared) ? Number(declared) : null,
    })
    return NextResponse.json({ file: result }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return fail(error)
  }
}
