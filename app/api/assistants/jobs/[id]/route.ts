import { NextRequest, NextResponse } from 'next/server'
import { getCachedUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/cron-auth'
import { fromSession, isServiceError } from '@/lib/services/context'
import { ackAgentJob, BACKGROUND_LIMIT_MESSAGE, cancelAgentJob, isUuid, setAgentJobBackground } from '@/lib/assistants/background'

/**
 * One of the signed-in person's Agent jobs (lib/assistants/background.ts),
 * POST { action }:
 *   background   the panel closed mid-turn: keep working in the background
 *                (409 `limit` when the person already has the maximum running)
 *   foreground   the panel is open again: no notification needed
 *   cancel       Stop: the turn stops at its next step
 *   ack          the browser merged the transcript (`read`: the panel was open,
 *                so the bell item is read too)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await request.json().catch(() => null) as { action?: string; read?: boolean } | null
  try {
    const ctx = await fromSession()
    if (!ctx.actorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const owner = { tenantId: ctx.tenantId, userId: ctx.actorId, jobId: id }
    const db = createServiceClient()
    switch (body?.action) {
      case 'background':
      case 'foreground': {
        const result = await setAgentJobBackground(db, { ...owner, background: body.action === 'background' })
        if (result.refused === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
        if (result.refused === 'limit') return NextResponse.json({ error: BACKGROUND_LIMIT_MESSAGE, code: 'limit', background: false }, { status: 409 })
        return NextResponse.json({ background: result.background, status: result.status })
      }
      case 'cancel':
        return NextResponse.json({ cancelled: await cancelAgentJob(db, owner) })
      case 'ack':
        return NextResponse.json({ acked: await ackAgentJob(db, { ...owner, read: body.read === true }) })
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[assistants] job action failed', error)
    return NextResponse.json({ error: 'Could not update the Agent job' }, { status: 500 })
  }
}
