import { NextRequest, NextResponse } from 'next/server'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { resolveAgentToolContext } from '@/lib/agent-tool-auth'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const ctx = await resolveAgentToolContext(request, body)
  if ('error' in ctx) return ctx.error
  const { tenantId, supabase } = ctx

  const { action, table_name, filter_column, filter_value, limit, data, updates } = body
  const agentId = String(request.headers.get('x-agent-id') ?? body.agent_id ?? '').trim()

  let outputConfig = normalizeAgentOutputConfig({})
  if (agentId) {
    const { data: agent } = await (supabase as any).from('agents').select('output_config').eq('id', agentId).eq('tenant_id', tenantId).single()
    if (agent) outputConfig = normalizeAgentOutputConfig((agent as any).output_config)
  }

  // Resolve table by name
  const { data: table } = await supabase.from('custom_tables').select('id, name').eq('name', table_name).eq('tenant_id', tenantId).single()
  if (!table) return NextResponse.json({ error: `Table "${table_name}" not found` }, { status: 404 })
  const tableId = table.id

  if (outputConfig.data_access.mode === 'selected' && !outputConfig.data_access.table_ids.includes(tableId)) {
    return NextResponse.json({ error: `Table "${(table as any).name}" is not in this agent's approved data scope` }, { status: 403 })
  }

  try {
    if (action === 'query') {
      let q = supabase.from('custom_table_rows').select('id, data').eq('table_id', tableId).limit(Math.min(limit ?? 50, 100))
      if (filter_column && filter_value != null) {
        q = q.filter(`data->>${filter_column}`, 'eq', String(filter_value)) as any
      }
      const { data: rows, error } = await q
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ rows: (rows ?? []).map((r: any) => ({ id: r.id, ...r.data })), count: rows?.length ?? 0 })
    }

    if (action === 'insert') {
      const { error } = await supabase.from('custom_table_rows').insert({ table_id: tableId, tenant_id: tenantId, data: data ?? {} })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    if (action === 'update') {
      // Fetch matching rows, then update each
      const { data: rows } = await supabase.from('custom_table_rows').select('id, data')
        .eq('table_id', tableId)
        .filter(`data->>${filter_column}`, 'eq', String(filter_value)) as any
      let updated = 0
      for (const row of (rows ?? [])) {
        await supabase.from('custom_table_rows').update({ data: { ...row.data, ...updates } } as any).eq('id', row.id)
        updated++
      }
      return NextResponse.json({ success: true, updated })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
