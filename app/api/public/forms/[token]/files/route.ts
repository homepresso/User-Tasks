import { NextResponse, type NextRequest } from 'next/server'
import { ServiceError } from '@/lib/services/context'
import { anonymousRequest, NO_STORE, publicError } from '@/lib/public-forms/route'

/**
 * Upload one file into an Attachments field of a public form: only when
 * the form allows anonymous uploads, with its per-visit upload key
 * (x-upload-key) and its size / type / count limits; the bytes are checked
 * like every upload (lib/services/form-files.ts).
 */

export const dynamic = 'force-dynamic'

const MAX_BODY = 4 * 1024 * 1024 + 64 * 1024

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
      throw new ServiceError('validation_error', 'Expected multipart/form-data', { status: 415 })
    }
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY) throw new ServiceError('validation_error', 'Files must be 4 MB or smaller', { status: 413 })
    const { ctx, resolved } = await anonymousRequest(request, token)
    if (!ctx.anonymous?.uploads.enabled) throw ServiceError.forbidden('Uploads are not available on this form')
    let form: FormData
    try { form = await request.formData() } catch { throw ServiceError.validation('The upload could not be read — try again') }
    const file = form.get('file')
    if (!file || typeof file === 'string') throw ServiceError.validation('No file was sent')
    const fieldKey = String(form.get('field_key') ?? '').trim()
    if (!fieldKey) throw ServiceError.validation('field_key is required')
    const declared = String(form.get('size') ?? '').trim()
    const { uploadFormFile } = await import('@/lib/services/form-files')
    const result = await uploadFormFile(ctx, {
      context: { kind: 'form', formId: resolved.formId },
      field_key: fieldKey,
      name: file.name || 'file',
      bytes: new Uint8Array(await file.arrayBuffer()),
      declared_size: /^\d+$/.test(declared) ? Number(declared) : null,
    })
    return NextResponse.json({ file: result }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return publicError(error, 'The upload failed — try again', 'files')
  }
}
