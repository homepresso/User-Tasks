import { NextRequest, NextResponse } from 'next/server'
import { getCachedUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/cron-auth'
import { fromSession, isServiceError } from '@/lib/services/context'
import { listAgentJobs } from '@/lib/assistants/background'

/**
 * The signed-in person's Agent jobs for one conversation
 * (GET ?conversation_id=…): turns still running (in this tab or the
 * background) and finished ones the browser has not merged yet, with their
 * transcript (lib/assistants/background.ts). Own jobs only.
 */
export async function GET(request: NextRequest) {
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const conversationId = request.nextUrl.searchParams.get('conversation_id') ?? ''
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(conversationId)) return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
  try {
    const ctx = await fromSession()
    if (!ctx.actorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const jobs = await listAgentJobs(createServiceClient(), { tenantId: ctx.tenantId, userId: ctx.actorId, conversationId })
    return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[assistants] list jobs failed', error)
    return NextResponse.json({ error: 'Could not load the Agent\'s jobs' }, { status: 500 })
  }
}
