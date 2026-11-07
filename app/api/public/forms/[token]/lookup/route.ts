import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ServiceError } from '@/lib/services/context'
import { anonymousRequest, NO_STORE, publicError, readJson } from '@/lib/public-forms/route'

/** Lookup suggestions on a public form: only fields with "Allow anonymous read" (lib/services/form-lookup.ts). */

export const dynamic = 'force-dynamic'

const Body = z.object({
  field_key: z.string().min(1).max(64),
  query: z.string().max(200).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  resolve: z.array(z.union([z.string().max(1000), z.number()]).transform(String)).max(20).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const parsed = Body.safeParse(await readJson(request, 64_000))
    if (!parsed.success) throw ServiceError.validation('Invalid request')
    const { ctx, resolved } = await anonymousRequest(request, token)
    const { lookupFormField } = await import('@/lib/services/form-lookup')
    return NextResponse.json(await lookupFormField(ctx, resolved.formId, parsed.data), { headers: NO_STORE })
  } catch (error) {
    return publicError(error, 'The lookup is not available right now', 'lookup')
  }
}
