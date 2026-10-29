import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { isServiceError } from '@/lib/services/context'
import { initDirectUpload } from '@/lib/services/form-files'
import { uploadSession } from '@/lib/services/form-files-session'

/**
 * Start a direct-to-storage upload of one file into an Attachments field
 * (session cookie auth, JSON). Same authorisation, limits and quota as the
 * server upload; returns a short-lived signed PUT URL for exactly one object
 * and the file id to complete, or `{ mode: "server" }` when the storage
 * provider can't sign uploads (send the file to ../ instead).
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

const Body = z.object({
  field_key: z.string().min(1).max(64),
  name: z.string().min(1).max(1000),
  size: z.number().int().positive(),
  task_id: z.string().max(64).optional(),
  form_id: z.string().max(64).optional(),
  workflow_id: z.string().max(64).optional(),
  start_workflow_id: z.string().max(64).optional(),
})

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
  }
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  try {
    const { ctx, context } = await uploadSession(parsed.data)
    const result = await initDirectUpload(ctx, { context, field_key: parsed.data.field_key, name: parsed.data.name, size: parsed.data.size })
    return NextResponse.json(result, { status: result.mode === 'direct' ? 201 : 200, headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[forms.files.init]', error)
    return NextResponse.json({ error: 'The upload could not be started' }, { status: 500, headers: NO_STORE })
  }
}
