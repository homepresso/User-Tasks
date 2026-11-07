import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fromSession, isServiceError } from '@/lib/services/context'
import { previewCustomReference } from '@/lib/services/custom-references'

/**
 * The custom reference builder's "Load sample" (stage 'source': the
 * operation's raw response, as a model) and "Test" (stage 'shaped': the
 * finished result, stages and timing) on an UNSAVED draft. Runs through the
 * reference executor — egress guard, credentials, call log — and needs
 * integrations.manage_references plus integrations.test (or .edit).
 */

const Body = z.object({
  integration_id: z.string().min(1).max(64),
  reference_id: z.string().max(64).nullish(),
  custom: z.record(z.string(), z.unknown()),
  inputs: z.record(z.string(), z.unknown()).optional(),
  stage: z.enum(['source', 'shaped']).optional(),
  send: z.boolean().optional(),
  confirm: z.string().max(20).optional(),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
  }
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  try {
    const { integration_id, ...input } = parsed.data
    const result = await previewCustomReference(await fromSession(), integration_id, input)
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[integrations.customReferencePreview]', error)
    return NextResponse.json({ error: 'The preview could not be run' }, { status: 500, headers: NO_STORE })
  }
}
