import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ServiceError } from '@/lib/services/context'
import { anonymousRequest, NO_STORE, publicError, readJson } from '@/lib/public-forms/route'

/** A form rule's server step on a public form: only steps ticked "Allow for anonymous" (lib/services/form-rule-actions.ts). */

export const dynamic = 'force-dynamic'

const Body = z.object({
  rule_id: z.string().min(1).max(40),
  action_index: z.number().int().min(0).max(20),
  branch: z.object({ response: z.string().regex(/^[a-z0-9_]{1,40}$/), index: z.number().int().min(0).max(20) }).nullable().optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  event: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotency_key: z.string().min(8).max(100),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const parsed = Body.safeParse(await readJson(request, 256_000))
    if (!parsed.success) throw ServiceError.validation('Invalid request')
    const { ctx, resolved } = await anonymousRequest(request, token)
    const { runRuleAction } = await import('@/lib/services/form-rule-actions')
    return NextResponse.json(await runRuleAction(ctx, { form_id: resolved.formId }, parsed.data), { headers: NO_STORE })
  } catch (error) {
    return publicError(error, 'That step could not run', 'ruleAction')
  }
}
