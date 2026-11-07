import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ServiceError } from '@/lib/services/context'
import { anonymousRequest, NO_STORE, publicError, readJson } from '@/lib/public-forms/route'

/** Public forms never upload straight to storage: this answers `{ mode: "server" }` (send the file to ../) when uploads are allowed. */

export const dynamic = 'force-dynamic'

const Body = z.object({ field_key: z.string().min(1).max(64), name: z.string().min(1).max(1000), size: z.number().int().positive() })

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const parsed = Body.safeParse(await readJson(request, 8_000))
    if (!parsed.success) throw ServiceError.validation('Invalid request')
    const { ctx, resolved } = await anonymousRequest(request, token)
    const { initDirectUpload } = await import('@/lib/services/form-files')
    const result = await initDirectUpload(ctx, { context: { kind: 'form', formId: resolved.formId }, ...parsed.data })
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    return publicError(error, 'The upload could not be started', 'files.init')
  }
}
