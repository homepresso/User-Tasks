import { NextRequest, NextResponse } from 'next/server'
import { getCachedUser } from '@/lib/supabase/server'
import { fromSession, isServiceError } from '@/lib/services/context'
import { rateLimit } from '@/lib/rate-limit'
import { ATTACHMENT_LIMITS } from '@/lib/assistants/attachments-core'
import type { ChatAttachment } from '@/lib/assistants/types'

export const maxDuration = 60

/**
 * The Agent's attachments: converts the signed-in person's files for the
 * next chat message (POST multipart/form-data, field `files`). Only for
 * people the Agent is available to. The files are read in memory and NOT
 * stored — the response carries the converted parts (extracted text, a
 * parsed process diagram, or an image data URL), which the panel sends with
 * the message they belong to. Type sniffed from the bytes. A file that can't
 * be read comes back as a `failed` attachment with the reason: it travels
 * with the message (the model is told it was received but unreadable, and
 * the chip shows why). PDFs for a model that reads PDFs itself may be up to
 * ATTACHMENT_LIMITS.maxPdfBytes; everything else maxFileBytes.
 */
export async function POST(request: NextRequest) {
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const max = Math.max(ATTACHMENT_LIMITS.maxFileBytes * ATTACHMENT_LIMITS.maxFilesPerMessage, ATTACHMENT_LIMITS.maxPdfBytes * 2) + 1_000_000
  if (Number(request.headers.get('content-length') ?? 0) > max) return NextResponse.json({ error: `Attach at most ${ATTACHMENT_LIMITS.maxFilesPerMessage} files of up to ${ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024} MB (PDFs up to ${ATTACHMENT_LIMITS.maxPdfBytes / 1024 / 1024} MB for models that read PDFs)` }, { status: 413 })
  try {
    const ctx = await fromSession()
    const { attachmentUploadOptions } = await import('@/lib/services/assistants')
    const options = await attachmentUploadOptions(ctx)
    if (!options) return NextResponse.json({ error: 'The Agent is not available to you' }, { status: 403 })
    const limited = await rateLimit(`assistant:attach:${ctx.tenantId}:${ctx.actorId}`, { max: 30, windowMs: 60_000 })
    if (!limited.ok) return NextResponse.json({ error: 'Too many uploads — wait a moment' }, { status: 429 })
    let form: FormData
    try { form = await request.formData() } catch { return NextResponse.json({ error: 'Send the files as multipart/form-data' }, { status: 400 }) }
    const files = form.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f)
    if (!files.length) return NextResponse.json({ error: 'No files' }, { status: 400 })
    const { convertAttachment, AttachmentError } = await import('@/lib/assistants/attachments')
    const attachments: ChatAttachment[] = []
    const errors: Array<{ name: string; error: string }> = []
    let pdfBytes = 0
    for (const [i, file] of files.entries()) {
      const name = String(file.name || 'file').slice(0, 200)
      if (i >= ATTACHMENT_LIMITS.maxFilesPerMessage) { errors.push({ name, error: `At most ${ATTACHMENT_LIMITS.maxFilesPerMessage} files per message` }); continue }
      const failed = (error: string) => attachments.push({ name: name.replace(/[\r\n]/g, ' '), mime_type: file.type && file.type.length <= 100 ? file.type : 'application/octet-stream', size: file.size, kind: 'failed', error })
      const limit = options.pdf ? ATTACHMENT_LIMITS.maxPdfBytes : ATTACHMENT_LIMITS.maxFileBytes
      if (file.size > limit) { failed(`Larger than ${limit / 1024 / 1024} MB`); continue }
      try {
        const a = await convertAttachment(Buffer.from(await file.arrayBuffer()), name, options)
        // PDFs kept whole for the model: at most maxPdfBytes together on one message.
        if (a.kind === 'document' && a.data_url) {
          if (pdfBytes + a.size > ATTACHMENT_LIMITS.maxPdfBytes) { failed(`The PDFs on one message can be at most ${ATTACHMENT_LIMITS.maxPdfBytes / 1024 / 1024} MB together — send this one with its own message`); continue }
          pdfBytes += a.size
        }
        attachments.push(a)
      } catch (error) {
        failed(error instanceof AttachmentError ? error.message : 'Could not read this file')
      }
    }
    return NextResponse.json({ attachments, errors }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[assistants] attachments failed', error)
    return NextResponse.json({ error: 'The files could not be read' }, { status: 500 })
  }
}
