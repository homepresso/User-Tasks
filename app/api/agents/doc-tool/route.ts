import { NextRequest, NextResponse } from 'next/server'
import { resolveSessionToolRuntime } from '@/lib/agent-tool-auth'
import { executeAgentTool } from '@/lib/agents/tools'
import { BUILTIN_TOOL_DEFS } from '@/lib/agent-tool-defs'

/** Call an agent's document tool (generate_excel) as the signed-in user. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const resolved = await resolveSessionToolRuntime(request, body)
  if ('error' in resolved) return resolved.error
  if (body.action !== 'excel') return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
  const tool = BUILTIN_TOOL_DEFS.find((t) => t.name === 'generate_excel')!
  const result = await executeAgentTool(tool, body, resolved.runtime, { facts: {}, attachments: [] })
  return NextResponse.json(result, { status: (result as any)?.error ? 400 : 200 })
}
