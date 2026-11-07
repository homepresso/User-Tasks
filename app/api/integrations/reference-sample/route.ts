import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fromSession, isServiceError } from '@/lib/services/context'
import { loadReferenceSample } from '@/lib/services/references'

/**
 * "Load sample" in the designers: run a reference once with sample inputs
 * and fold the response into its response model (saved with
 * integrations.manage_references). Session cookie auth, JSON only. The
 * permission, ownership, egress and credential rules live in
 * loadReferenceSample (lib/services/references.ts).
 */

const Body = z.object({
  reference_id: z.string().min(1).max(64),
  inputs: z.record(z.string(), z.unknown()).optional(),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415, headers: NO_STORE })
  }
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  try {
    const result = await loadReferenceSample(await fromSession(), parsed.data.reference_id, parsed.data.inputs ?? {})
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    console.error('[integrations.referenceSample]', error)
    return NextResponse.json({ error: 'The sample could not be loaded' }, { status: 500, headers: NO_STORE })
  }
}
