import { NextResponse, type NextRequest } from 'next/server'
import { anonymousRequest, NO_STORE, publicError } from '@/lib/public-forms/route'

/** Remove a pending upload of a public form: the same visit's upload key only (lib/services/form-files.ts). */

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  try {
    const { ctx } = await anonymousRequest(request, token)
    const { removePendingFormFile } = await import('@/lib/services/form-files')
    return NextResponse.json(await removePendingFormFile(ctx, id), { headers: NO_STORE })
  } catch (error) {
    return publicError(error, 'The file could not be removed', 'files.delete')
  }
}
