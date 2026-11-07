import { NextRequest, NextResponse } from 'next/server'
import { resolveSessionToolRuntime } from '@/lib/agent-tool-auth'
import { AgentToolError } from '@/lib/agents/tools/runtime'
import { runDataTool } from '@/lib/agents/tools/data'

const ACTIONS: Record<string, string> = { query: 'query_data_table', insert: 'insert_data_row', update: 'update_data_rows', delete: 'delete_data_rows' }

/** Call an agent's data-table tool as the signed-in user (scope + permissions enforced). */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const resolved = await resolveSessionToolRuntime(request, body)
  if ('error' in resolved) return resolved.error
  const tool = ACTIONS[String(body.action ?? '')]
  if (!tool) return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
  try {
    return NextResponse.json(await runDataTool(resolved.runtime, tool, body))
  } catch (e) {
    if (e instanceof AgentToolError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: (e as Error)?.message ?? 'Tool failed' }, { status: 500 })
  }
}
