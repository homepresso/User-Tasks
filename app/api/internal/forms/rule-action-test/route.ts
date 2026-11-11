import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fromSession, isServiceError } from '@/lib/services/context'
import { testRuleAction } from '@/lib/services/form-rule-actions'

/**
 * The form designer's "Test" on a rule's data / API step (lib/services/form-rule-actions.ts
 * testRuleAction): runs a table read / list or a read-only API call as the author has it,
 * with sample values and the author's own rights; nothing is written.
 */

const Body = z.object({
  action: z.record(z.string(), z.unknown()),
  values: z.record(z.string(), z.unknown()).nullable().optional(),
  fields: z.array(z.unknown()).max(200).optional(),
  layout: z.record(z.string(), z.unknown()).nullable().optional(),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest) {
  const raw = await request.text().catch(() => '')
  if (raw.length > 512_000) return NextResponse.json({ error: 'Request too large' }, { status: 413, headers: NO_STORE })
  let json: unknown = null
  try { json = JSON.parse(raw) } catch { /* invalid */ }
  const parsed = Body.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  try {
    return NextResponse.json(await testRuleAction(await fromSession(), parsed.data), { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[forms.ruleActionTest]', error)
    return NextResponse.json({ error: 'The test could not run' }, { status: 500, headers: NO_STORE })
  }
}
