import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ServiceError } from '@/lib/services/context'
import { anonymousRequest, NO_STORE, publicError, readJson } from '@/lib/public-forms/route'

/** A dynamic property's value on a public form: only bindings with "Allow anonymous read" (lib/services/form-dynamic-values.ts). */

export const dynamic = 'force-dynamic'

const Body = z.object({
  field_key: z.string().min(1).max(64),
  prop: z.string().min(1).max(80),
  values: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const parsed = Body.safeParse(await readJson(request, 128_000))
    if (!parsed.success) throw ServiceError.validation('Invalid request')
    const { ctx, resolved } = await anonymousRequest(request, token)
    const { resolveDynamicValue } = await import('@/lib/services/form-dynamic-values')
    return NextResponse.json(await resolveDynamicValue(ctx, { form_id: resolved.formId }, parsed.data), { headers: NO_STORE })
  } catch (error) {
    return publicError(error, 'The value is not available right now', 'dynamicValue')
  }
}
