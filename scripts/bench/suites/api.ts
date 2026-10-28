/**
 * API suite (needs the app running): sequential requests with the bench
 * tenant API key — p50/p95/max per endpoint after a short warm-up.
 */
import { readState } from '../lib/env'
import { summarize, type SuiteResult } from '../lib/results'

interface Probe { label: string; send: () => Promise<Response> }

export async function runApi(opts: { appUrl: string; requests: number }): Promise<SuiteResult> {
  const state = readState()
  const auth = { authorization: `Bearer ${state.apiKey}` }
  const get = (path: string) => () => fetch(`${opts.appUrl}${path}`, { headers: auth })
  let rpcId = 0
  const mcp = (method: string, params: Record<string, unknown> = {}) => () => fetch(`${opts.appUrl}/api/mcp`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })

  // Pick a cheap read tool from the live tool list.
  const listRes = await mcp('tools/list')()
  const listJson = (await listRes.json().catch(() => null)) as { result?: { tools?: Array<{ name: string }> } } | null
  const tools = listJson?.result?.tools ?? []
  const toolName = ['workflows_list', 'list_workflows'].find((n) => tools.some((t) => t.name === n)) ?? tools.find((t) => t.name.endsWith('_list'))?.name
  if (!toolName) throw new Error(`MCP tools/list returned no usable tool (HTTP ${listRes.status})`)

  const probes: Probe[] = [
    { label: 'GET /api/v1/workflows?active=false', send: get('/api/v1/workflows?active=false') },
    { label: 'GET /api/v1/tasks', send: get('/api/v1/tasks') },
    { label: 'GET /api/v1/me', send: get('/api/v1/me') },
    { label: 'MCP tools/list', send: mcp('tools/list') },
    { label: `MCP tools/call ${toolName}`, send: mcp('tools/call', { name: toolName, arguments: {} }) },
  ]

  const data: Record<string, unknown> = { tool_count: tools.length, tool_called: toolName }
  const rows: Array<Array<string | number | null>> = []
  for (const probe of probes) {
    process.stdout.write(`  api ${probe.label} `)
    for (let i = 0; i < 5; i++) await (await probe.send()).arrayBuffer() // warm-up
    const times: number[] = []
    const statuses: Record<string, number> = {}
    let bytes = 0
    for (let i = 0; i < opts.requests; i++) {
      const started = performance.now()
      const res = await probe.send()
      const body = await res.arrayBuffer()
      times.push(performance.now() - started)
      statuses[res.status] = (statuses[res.status] ?? 0) + 1
      bytes = body.byteLength
    }
    const s = summarize(times)
    console.log(`p50 ${s.p50} ms`)
    data[probe.label] = { ...s, statuses, response_bytes: bytes }
    rows.push([probe.label, s.p50, s.p95, s.max, s.mean, Object.entries(statuses).map(([k, v]) => `${k}×${v}`).join(' '), bytes])
  }

  return {
    data,
    tables: [{
      title: `API latency (${opts.requests} sequential requests each after 5 warm-ups, tenant API key, ms)`,
      columns: ['request', 'p50', 'p95', 'max', 'mean', 'statuses', 'response bytes'],
      rows,
    }],
    notes: [`MCP server exposes ${tools.length} tools; tools/call used ${toolName} with no arguments.`],
  }
}
