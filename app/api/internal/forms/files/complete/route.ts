import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/cron-auth'
import { fromSession, isServiceError, ServiceError } from '@/lib/services/context'
import { completeDirectUpload, loadFormFile } from '@/lib/services/form-files'

/**
 * Finish a direct-to-storage upload: the uploader only, in the file's
 * workspace, within the upload window. The server reads the object back and
 * verifies it (size, content, type, SVG sanitising, checksum, optional scan)
 * before it can be submitted; a file that fails is deleted. Returns the
 * file object for the field's value.
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const Body = z.object({ file_id: z.string().uuid() })

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
  }
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  try {
    const row = await loadFormFile(createServiceClient() as never, parsed.data.file_id)
    if (!row) throw ServiceError.notFound('Upload not found')
    const ctx = await fromSession({ tenantId: row.tenant_id }).catch((error) => {
      if (isServiceError(error) && error.code === 'forbidden') throw ServiceError.notFound('Upload not found')
      throw error
    })
    const file = await completeDirectUpload(ctx, parsed.data.file_id)
    return NextResponse.json({ file }, { status: 201, headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[forms.files.complete]', error)
    return NextResponse.json({ error: 'The upload could not be finished' }, { status: 500, headers: NO_STORE })
  }
}
