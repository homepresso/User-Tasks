import { NextRequest, NextResponse } from 'next/server'
import { resolveSessionToolRuntime } from '@/lib/agent-tool-auth'
import { AgentToolError } from '@/lib/agents/tools/runtime'
import { runActionTool } from '@/lib/agents/tools/actions'

/** Call an agent's task / workflow tool as the signed-in user (agent scope + the user's permissions). */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const resolved = await resolveSessionToolRuntime(request, body)
  if ('error' in resolved) return resolved.error
  try {
    return NextResponse.json(await runActionTool(resolved.runtime, String(body.action ?? '').trim(), body))
  } catch (e) {
    if (e instanceof AgentToolError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: (e as Error)?.message ?? 'Tool failed' }, { status: 500 })
  }
}
