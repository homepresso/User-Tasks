import { NextResponse, type NextRequest } from 'next/server'
import { fromSession, isServiceError, ServiceError } from '@/lib/services/context'
import { loadFormFile, removePendingFormFile } from '@/lib/services/form-files'
import { createServiceClient } from '@/lib/cron-auth'

/**
 * Remove a pending upload (the × on a file before the form is submitted):
 * the uploader only, in the file's workspace. Submitted files stay.
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const row = await loadFormFile(createServiceClient() as never, id)
    if (!row) throw ServiceError.notFound('File not found')
    const ctx = await fromSession({ tenantId: row.tenant_id }).catch((error) => {
      // Not a member of the file's workspace: the file "doesn't exist".
      if (isServiceError(error) && error.code === 'forbidden') throw ServiceError.notFound('File not found')
      throw error
    })
    const result = await removePendingFormFile(ctx, id)
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[forms.files.delete]', error)
    return NextResponse.json({ error: 'The file could not be removed' }, { status: 500, headers: NO_STORE })
  }
}
