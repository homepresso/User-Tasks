import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ServiceError } from '@/lib/services/context'
import { ANONYMOUS_LIMITS, HONEYPOT_FIELD } from '@/lib/forms/anonymous'
import { NO_STORE, publicError, readJson, visitorIp } from '@/lib/public-forms/route'

/**
 * Submit a public form link (/p/<token>): no session, JSON only, body
 * capped. Honeypot, minimum fill time, optional captcha, per-IP and daily
 * limits and the submission itself are lib/services/anonymous-forms.ts.
 */

export const dynamic = 'force-dynamic'

const Body = z.object({
  values: z.record(z.string(), z.unknown()).optional(),
  button_id: z.string().max(40).nullable().optional(),
  idempotency_key: z.string().min(8).max(100).nullable().optional(),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  variables: z.record(z.string(), z.unknown()).nullable().optional(),
  ticket: z.string().max(80).nullable().optional(),
  captcha: z.string().max(4096).nullable().optional(),
  upload_key: z.string().max(128).nullable().optional(),
  [HONEYPOT_FIELD]: z.string().max(500).nullable().optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const parsed = Body.safeParse(await readJson(request, ANONYMOUS_LIMITS.submitBodyBytes))
    if (!parsed.success) throw ServiceError.validation('Invalid request')
    const body = parsed.data
    const { submitAnonymousForm } = await import('@/lib/services/anonymous-forms')
    const result = await submitAnonymousForm(token, { ...body, hp: body[HONEYPOT_FIELD] ?? null }, { ip: visitorIp(request), userAgent: request.headers.get('user-agent') })
    // The visitor sees what happened, not the workflow runs' ids.
    return NextResponse.json({
      submission: { id: result.submission.id, created_at: result.submission.created_at },
      effects: result.effects,
      started: result.runs.filter((r) => r.status === 'queued').length,
    }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return publicError(error, 'Could not submit the form.', 'submit')
  }
}
