/**
 * End-to-end check that REST, MCP and the CLI can each create, read, edit
 * and delete every configurable resource against a running server, including
 * the "get → edit the file → update" round trip and, for workflows, adding a
 * node + edge, publishing, listing versions and running the new version.
 *
 * Opt-in: it writes (and then deletes) real assets in the workspace the key
 * belongs to, so point it at a local or throwaway workspace.
 *
 *   USERTASKS_URL=http://localhost:3000 USERTASKS_API_KEY=ut_… npx tsx scripts/e2e-surfaces.ts
 *
 * Optional:
 *   USERTASKS_CLI_BIN   path to the CLI entry (default packages/cli/dist/bin.js
 *                       when built — `npm run cli:build` — else the TypeScript source via tsx)
 *   E2E_ONLY            comma-separated resource names to run (e.g. workflows,integrations)
 *
 * Exit code 0 when every step passes; prints a resource × surface table.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API payloads */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = (process.env.USERTASKS_URL ?? '').replace(/\/+$/, '')
const KEY = process.env.USERTASKS_API_KEY ?? ''
if (!BASE || !KEY) {
  console.error('Set USERTASKS_URL and USERTASKS_API_KEY (a key for a local/throwaway workspace). See the header of scripts/e2e-surfaces.ts.')
  process.exit(2)
}

const ROOT = resolve(__dirname, '..')
const ONLY = new Set((process.env.E2E_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const WORK = mkdtempSync(join(tmpdir(), 'ut-e2e-surfaces-'))
const RUN = Date.now().toString(36)

// ─── Surfaces ───

class StepError extends Error {}

/**
 * fetch with one retry on a network error: a keep-alive socket the server
 * already closed (idle while the CLI steps ran) fails before the request is
 * sent, so retrying cannot double-apply it.
 */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    return fetch(url, init)
  }
}

async function rest(method: string, path: string, body?: unknown): Promise<any> {
  const res = await send(`${BASE}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  if (!res.ok || json?.success === false) throw new StepError(`${method} ${path} → ${res.status} ${json?.error ?? text.slice(0, 200)}`)
  return json && 'data' in json ? json.data : json
}

let rpcId = 0
async function mcp(tool: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await send(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }),
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok || json?.error) throw new StepError(`MCP ${tool} → ${res.status} ${json?.error?.message ?? ''}`)
  const text = json?.result?.content?.[0]?.text ?? ''
  if (json?.result?.isError) throw new StepError(`MCP ${tool}: ${text}`)
  try { return JSON.parse(text) } catch { return text }
}

const CLI_BIN = process.env.USERTASKS_CLI_BIN ?? join(ROOT, 'packages', 'cli', 'dist', 'bin.js')
const cliCommand = existsSync(CLI_BIN)
  ? { cmd: process.execPath, pre: [CLI_BIN] }
  : { cmd: process.execPath, pre: [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(ROOT, 'packages', 'cli', 'tsconfig.json'), join(ROOT, 'packages', 'cli', 'src', 'bin.ts')] }
const cliEnv = {
  ...process.env,
  USERTASKS_URL: BASE,
  USERTASKS_API_KEY: KEY,
  USERTASKS_OUTPUT: 'json',
  USERTASKS_PROFILE: '',
  XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'ut-e2e-cfg-')),
}

function cli(...args: string[]): any {
  try {
    const out = execFileSync(cliCommand.cmd, [...cliCommand.pre, ...args], { env: cliEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    try { return out.trim() ? JSON.parse(out) : null } catch { return out }
  } catch (error: any) {
    throw new StepError(`usertasks ${args.join(' ')} → exit ${error.status}: ${String(error.stderr || error.stdout).trim().slice(0, 300)}`)
  }
}

/** Write JSON to a temp file and return its path (the CLI's -f input). */
function file(name: string, value: unknown): string {
  const path = join(WORK, `${RUN}-${name}.json`)
  writeFileSync(path, JSON.stringify(value, null, 2))
  return path
}
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
/** `usertasks … -o json > file`: run a CLI read and save its output as the edit file. */
function cliToFile(name: string, ...args: string[]): string {
  return file(name, cli(...args))
}

// ─── Results ───

type Surface = 'REST' | 'MCP' | 'CLI'
const results: Array<{ resource: string; surface: Surface; ok: boolean; steps: number; failure?: string }> = []

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StepError(message)
}

async function flow(resource: string, surface: Surface, body: (step: (name: string, fn: () => unknown) => Promise<any>, cleanup: (fn: () => unknown) => void) => Promise<void>) {
  if (ONLY.size && !ONLY.has(resource)) return
  const cleanups: Array<() => unknown> = []
  let steps = 0
  let current = ''
  try {
    await body(async (name, fn) => {
      current = name
      const value = await fn()
      steps++
      return value
    }, (fn) => cleanups.unshift(fn))
    results.push({ resource, surface, ok: true, steps })
    console.log(`PASS ${resource} [${surface}] (${steps} steps)`)
  } catch (error) {
    const failure = `${current}: ${(error as Error).message}`
    results.push({ resource, surface, ok: false, steps, failure })
    console.log(`FAIL ${resource} [${surface}] ${failure}`)
  } finally {
    for (const fn of cleanups) {
      try { await fn() } catch { /* best effort */ }
    }
  }
}

/** Create-input fixtures shared by the three surfaces. */
const WF_NODES = [
  { id: 'trigger', type: 'manual', label: 'Manual', position: { x: 300, y: 20 }, config: {} },
  { id: 'log-1', type: 'log', label: 'First log', position: { x: 300, y: 160 }, config: { message: 'first', level: 'info' } },
]
const WF_EDGES = [{ id: 'e1', source: 'trigger', target: 'log-1' }]
const NEW_NODE = { id: 'log-2', type: 'log', label: 'Added by e2e', position: { x: 300, y: 300 }, config: { message: 'added node ran', level: 'info' } }
const NEW_EDGE = { id: 'e2', source: 'log-1', target: 'log-2' }
const DT_BODY = {
  inputs: [{ key: 'amount', label: 'Amount', type: 'number' }],
  outputs: [{ key: 'discount', label: 'Discount', type: 'number' }],
  rules: [{ label: 'Big order', conditions: [{ inputKey: 'amount', operator: 'greater_than', value: '100' }], outputs: { discount: 10 } }],
}
const ACTIVITY_SOURCE = 'async function run(inputs) { return { outputs: { doubled: Number(inputs.amount ?? 0) * 2 } } }'
const ACTIVITY_MANIFEST = { inputs: [{ name: 'amount', type: 'number', required: true }], outputs: [{ name: 'doubled', type: 'number' }] }

/** Did the run execute node `nodeId`? (node_results or logs mention it) */
function ranNode(run: any, nodeId: string): boolean {
  const results = run?.node_results ?? run?.run?.node_results ?? {}
  if (results && typeof results === 'object' && nodeId in results) return true
  const logs = run?.logs ?? run?.run?.logs ?? []
  return Array.isArray(logs) && logs.some((log: any) => log?.node_id === nodeId)
}

// ─── Workflows ───

async function workflowsCli() {
  await flow('workflows', 'CLI', async (step, cleanup) => {
    const created = await step('workflows create -f', () => cli('workflows', 'create', '-f', file('wf-create', { name: `e2e cli wf ${RUN}`, trigger_type: 'manual', nodes: WF_NODES, edges: WF_EDGES })))
    const id = created.workflow_id
    cleanup(() => cli('workflows', 'delete', id, '--yes'))
    await step('workflows get', () => check(cli('workflows', 'get', id).workflow.name === `e2e cli wf ${RUN}`, 'name mismatch'))
    await step('get --include-definition → update -f (unedited) → changed:false', () => {
      const path = cliToFile('wf-full', 'workflows', 'get', id, '--include-definition', 'true')
      check(cli('workflows', 'update', id, '-f', path).changed === false, 'unedited update reported a change')
    })
    const path = await step('workflows definition > wf.json', () => cliToFile('wf-def', 'workflows', 'definition', id))
    await step('edit wf.json (add node + edge, rename) → update -f', () => {
      const def = readJson(path)
      def.nodes.push(NEW_NODE)
      def.edges.push(NEW_EDGE)
      def.name = `e2e cli wf ${RUN} (edited)`
      writeFileSync(path, JSON.stringify(def, null, 2))
      const res = cli('workflows', 'update', id, '-f', path)
      check(res.changed === true && res.published === false, `unexpected update result ${JSON.stringify(res)}`)
    })
    await step('definition shows the edit', () => {
      const def = cli('workflows', 'definition', id)
      check(def.name.endsWith('(edited)') && def.nodes.some((n: any) => n.id === 'log-2') && def.edges.some((e: any) => e.id === 'e2'), 'edit not saved')
    })
    await step('workflows publish', () => check(cli('workflows', 'publish', id, '--set', 'notes=e2e add log-2').version_number === 1, 'expected version 1'))
    await step('workflows versions', () => check(cli('workflows', 'versions', id).versions?.length >= 1, 'no versions'))
    const run = await step('workflows start', () => cli('workflows', 'start', '--set', `workflow_id=${id}`))
    await step('runs get → new node ran', () => {
      const detail = cli('runs', 'get', run.run_id)
      check(detail.run?.status === 'completed', `run status ${detail.run?.status}`)
      check(ranNode(detail, 'log-2'), 'log-2 did not run')
    })
    await step('workflows deactivate / activate', () => {
      check(cli('workflows', 'deactivate', id).is_active === false, 'deactivate')
      check(cli('workflows', 'activate', id).is_active === true, 'activate')
    })
    await step('workflows delete', () => check(cli('workflows', 'delete', id, '--yes').deleted === true, 'delete'))
  })
}

async function workflowsRest() {
  await flow('workflows', 'REST', async (step, cleanup) => {
    const created = await step('POST /workflows', () => rest('POST', '/workflows', { name: `e2e rest wf ${RUN}`, trigger_type: 'manual', nodes: WF_NODES, edges: WF_EDGES }))
    const id = created.workflow_id
    cleanup(() => rest('DELETE', `/workflows/${id}`))
    await step('GET /workflows/{id}', () => rest('GET', `/workflows/${id}`))
    await step('GET ?include_definition → PATCH unedited → changed:false', async () => {
      const full = await rest('GET', `/workflows/${id}?include_definition=true`)
      check((await rest('PATCH', `/workflows/${id}`, full)).changed === false, 'unedited PATCH changed something')
    })
    const def = await step('GET /workflows/{id}/definition', () => rest('GET', `/workflows/${id}/definition`))
    await step('PATCH with added node + edge', async () => {
      def.nodes.push(NEW_NODE)
      def.edges.push(NEW_EDGE)
      check((await rest('PATCH', `/workflows/${id}`, def)).changed === true, 'edit not reported')
    })
    await step('POST /publish', async () => check((await rest('POST', `/workflows/${id}/publish`, { notes: 'e2e' })).version_number === 1, 'expected v1'))
    const versions = await step('GET /versions', () => rest('GET', `/workflows/${id}/versions`))
    await step('GET /versions/{versionId} has the new node', async () => {
      const { version } = await rest('GET', `/workflows/${id}/versions/${versions.versions[0].id}`)
      check(version.nodes.some((n: any) => n.id === 'log-2'), 'version lacks log-2')
    })
    const run = await step('POST /workflows/start', () => rest('POST', '/workflows/start', { workflow_id: id }))
    await step('GET /workflows/runs/{id} → new node ran', async () => {
      const detail = await rest('GET', `/workflows/runs/${run.run_id}`)
      check(ranNode(detail, 'log-2'), 'log-2 did not run')
    })
    await step('DELETE /workflows/{id}', () => rest('DELETE', `/workflows/${id}`))
  })
}

async function workflowsMcp() {
  await flow('workflows', 'MCP', async (step, cleanup) => {
    const created = await step('workflows_create', () => mcp('workflows_create', { name: `e2e mcp wf ${RUN}`, trigger_type: 'manual', nodes: JSON.stringify(WF_NODES), edges: JSON.stringify(WF_EDGES) }))
    const id = created.workflow.id
    cleanup(() => mcp('workflows_delete', { workflow_id: id }))
    await step('workflows_get', () => mcp('workflows_get', { workflow_id: id }))
    const { definition } = await step('workflows_get_definition', () => mcp('workflows_get_definition', { workflow_id: id }))
    await step('workflows_update { definition } unedited → changed:false', async () => check((await mcp('workflows_update', { workflow_id: id, definition })).changed === false, 'changed'))
    await step('workflows_update { definition + node + edge }', async () => {
      definition.nodes.push(NEW_NODE)
      definition.edges.push(NEW_EDGE)
      check((await mcp('workflows_update', { workflow_id: id, definition })).changed === true, 'edit not reported')
    })
    await step('workflows_publish', async () => check((await mcp('workflows_publish', { workflow_id: id, notes: 'e2e' })).version === 1, 'expected v1'))
    const { versions } = await step('workflows_versions_list', () => mcp('workflows_versions_list', { workflow_id: id }))
    await step('workflows_version_get', async () => check((await mcp('workflows_version_get', { workflow_id: id, version_id: versions[0].id })).version.nodes.some((n: any) => n.id === 'log-2'), 'version lacks log-2'))
    const run = await step('workflows_start', () => mcp('workflows_start', { workflow_id: id }))
    await step('workflows_run_get → new node ran', async () => {
      const detail = await mcp('workflows_run_get', { run_id: run.run_id ?? run.run?.id, include_logs: true })
      check(ranNode(detail, 'log-2'), `log-2 did not run: ${JSON.stringify(detail).slice(0, 200)}`)
    })
    await step('workflows_delete', () => mcp('workflows_delete', { workflow_id: id }))
  })
}

// ─── Integrations (+ references, objects, connectors) ───

const INTEGRATION_CONFIG = { base_url: 'https://api.example.com', auth_type: 'bearer', auth_config: { token: `e2e-secret-${RUN}` }, headers: {} }

async function integrationsCli() {
  await flow('integrations', 'CLI', async (step, cleanup) => {
    const { integration } = await step('integrations create -f', () => cli('integrations', 'create', '-f', file('int-create', { name: `e2e cli int ${RUN}`, type: 'rest_api', config: INTEGRATION_CONFIG })))
    cleanup(() => cli('integrations', 'delete', integration.id, '--yes'))
    const path = await step('integrations get > int.json (secret masked)', () => {
      const p = cliToFile('int-get', 'integrations', 'get', integration.id)
      check(!readFileSync(p, 'utf8').includes(`e2e-secret-${RUN}`), 'secret leaked in get')
      return p
    })
    await step('update -f int.json unedited', () => cli('integrations', 'update', integration.id, '-f', path))
    await step('edit name + header → update -f → get', () => {
      const doc = readJson(path)
      doc.integration.name = `e2e cli int ${RUN} (edited)`
      doc.integration.config.headers = { 'x-e2e': '1' }
      writeFileSync(path, JSON.stringify(doc))
      cli('integrations', 'update', integration.id, '-f', path)
      const after = cli('integrations', 'get', integration.id).integration
      check(after.name.endsWith('(edited)') && after.config.headers?.['x-e2e'] === '1', 'edit not saved')
      check(after.config.auth_config?.token === '__SECRET__', 'stored token was lost')
    })
    await step('integrations delete', () => cli('integrations', 'delete', integration.id, '--yes'))
  })
}

async function integrationsRest() {
  await flow('integrations', 'REST', async (step, cleanup) => {
    const { integration } = await step('POST /integrations', () => rest('POST', '/integrations', { name: `e2e rest int ${RUN}`, type: 'rest_api', config: INTEGRATION_CONFIG }))
    cleanup(() => rest('DELETE', `/integrations/${integration.id}`))
    const got = await step('GET /integrations/{id}', () => rest('GET', `/integrations/${integration.id}`))
    await step('PATCH with the GET body unedited', () => rest('PATCH', `/integrations/${integration.id}`, got))
    await step('PATCH edited name → GET', async () => {
      got.integration.name = `e2e rest int ${RUN} (edited)`
      await rest('PATCH', `/integrations/${integration.id}`, got)
      check((await rest('GET', `/integrations/${integration.id}`)).integration.name.endsWith('(edited)'), 'edit not saved')
    })
    await step('DELETE /integrations/{id}', () => rest('DELETE', `/integrations/${integration.id}`))
  })
}

async function integrationsMcp() {
  await flow('integrations', 'MCP', async (step, cleanup) => {
    const created = await step('integrations_create', () => mcp('integrations_create', { name: `e2e mcp int ${RUN}`, type: 'rest_api', config: JSON.stringify(INTEGRATION_CONFIG) }))
    const id = created.integration?.id ?? created.id
    cleanup(() => mcp('integrations_delete', { integration_id: id }))
    const got = await step('integrations_get', () => mcp('integrations_get', { integration_id: id }))
    const integration = got.integration ?? got
    await step('integrations_update (config from get, unedited)', () => mcp('integrations_update', { integration_id: id, config: JSON.stringify(integration.config) }))
    await step('integrations_update name → get', async () => {
      await mcp('integrations_update', { integration_id: id, name: `e2e mcp int ${RUN} (edited)` })
      const after = await mcp('integrations_get', { integration_id: id })
      check((after.integration ?? after).name.endsWith('(edited)'), 'edit not saved')
    })
    await step('integrations_delete', () => mcp('integrations_delete', { integration_id: id }))
  })
}

async function referencesCli() {
  await flow('references', 'CLI', async (step, cleanup) => {
    const { integration } = await step('integrations create', () => cli('integrations', 'create', '-f', file('ref-int', { name: `e2e ref host ${RUN}`, type: 'rest_api', config: { base_url: 'https://api.example.com', auth_type: 'none' } })))
    cleanup(() => cli('integrations', 'delete', integration.id, '--yes'))
    const { reference } = await step('references create', () => cli('references', 'create', integration.id, '-f', file('ref-create', { name: 'List orders', method: 'GET', path_template: '/orders' })))
    await step('references list', () => check(cli('references', 'list', integration.id).references.some((r: any) => r.id === reference.id), 'not listed'))
    const path = await step('references get > ref.json', () => cliToFile('ref-get', 'references', 'get', reference.id))
    await step('update -f unedited, then edited description', () => {
      cli('references', 'update', reference.id, '-f', path)
      const doc = readJson(path)
      doc.reference.description = 'edited by e2e'
      writeFileSync(path, JSON.stringify(doc))
      cli('references', 'update', reference.id, '-f', path)
      check(cli('references', 'get', reference.id).reference.description === 'edited by e2e', 'edit not saved')
    })
    await step('references delete', () => cli('references', 'delete', reference.id, '--yes'))
  })
}

async function dataTablesAndObjectsCli() {
  await flow('data tables', 'CLI', async (step, cleanup) => {
    const { data_table: table } = await step('tables create', () => cli('tables', 'create', '-f', file('tbl-create', { name: `e2e tbl ${RUN}`, columns: [{ key: 'amount', name: 'Amount', type: 'number' }] })))
    cleanup(() => cli('tables', 'delete', table.id, '--yes'))
    const path = await step('tables get > tbl.json', () => cliToFile('tbl-get', 'tables', 'get', table.id))
    await step('update -f unedited, then add a column', () => {
      cli('tables', 'update', table.id, '-f', path)
      const doc = readJson(path)
      doc.data_table.columns.push({ key: 'status', name: 'Status', type: 'text' })
      doc.data_table.description = 'edited by e2e'
      writeFileSync(path, JSON.stringify(doc))
      cli('tables', 'update', table.id, '-f', path)
      const after = cli('tables', 'get', table.id).data_table
      check(after.columns.some((c: any) => c.key === 'status') && after.description === 'edited by e2e', 'edit not saved')
    })
    const upserted = await step('rows upsert', () => cli('rows', 'upsert', table.id, '-f', file('rows', { rows: [{ data: { amount: 5, status: 'new' } }] })))
    const rowId = upserted.rows?.[0]?.row_id ?? upserted.results?.[0]?.row_id ?? upserted[0]?.row_id
    await step('rows list / get', () => {
      check(cli('rows', 'list', table.id).rows.length === 1, 'row not listed')
      check(cli('rows', 'get', table.id, rowId).row, 'row get')
    })
    await step('rows update → get', () => {
      cli('rows', 'update', table.id, rowId, '--set', 'data.status=done')
      const row = cli('rows', 'get', table.id, rowId).row
      check(JSON.stringify(row).includes('done'), 'row edit not saved')
    })
    await step('rows delete', () => cli('rows', 'delete', table.id, rowId, '--yes'))

    // Objects need a table to join over.
    const created = await step('objects create', () => cli('objects', 'create', '-f', file('obj-create', { name: `e2e obj ${RUN}`, sources: [{ source_type: 'table', table_id: table.id, alias: 'orders', is_primary: true }] })))
    const objectId = created.object.id
    cleanup(() => cli('objects', 'delete', objectId, '--yes'))
    const objPath = await step('objects get > obj.json', () => cliToFile('obj-get', 'objects', 'get', objectId))
    await step('objects update -f unedited → changed:false', () => check(cli('objects', 'update', objectId, '-f', objPath).changed === false, 'changed'))
    await step('objects edit name → update → get', () => {
      const doc = readJson(objPath)
      doc.object.name = `e2e obj ${RUN} (edited)`
      writeFileSync(objPath, JSON.stringify(doc))
      check(cli('objects', 'update', objectId, '-f', objPath).changed === true, 'edit not reported')
      check(cli('objects', 'get', objectId).object.name.endsWith('(edited)'), 'edit not saved')
    })
    await step('objects delete', () => cli('objects', 'delete', objectId, '--yes'))
    await step('tables delete', () => cli('tables', 'delete', table.id, '--yes'))
  })
}

async function connectorsCli() {
  await flow('connectors', 'CLI', async (step, cleanup) => {
    const catalog = await step('connectors catalog', () => cli('connectors', 'catalog'))
    const entries: any[] = catalog.connectors ?? catalog.catalog ?? catalog
    const template = entries.find((c: any) => (c.key ?? c.connector_key) === 'openai') ?? entries[0]
    const key = template.key ?? template.connector_key
    const created = await step(`connectors create (${key})`, () => cli('connectors', 'create', '-f', file('conn-create', { connector_key: key, display_name: `e2e conn ${RUN}`, credentials: { api_key: `sk-e2e-${RUN}` } })))
    const id = created.connector?.id ?? created.id
    cleanup(() => cli('connectors', 'delete', id, '--yes'))
    await step('connectors list', () => check(cli('connectors', 'list').connectors.some((c: any) => c.id === id), 'not listed'))
    const path = await step('connectors get > conn.json (credentials masked)', () => {
      const p = cliToFile('conn-get', 'connectors', 'get', id)
      check(!readFileSync(p, 'utf8').includes(`sk-e2e-${RUN}`), 'credential leaked')
      return p
    })
    await step('update -f unedited, then rename', () => {
      cli('connectors', 'update', id, '-f', path)
      const doc = readJson(path)
      doc.connector.display_name = `e2e conn ${RUN} (edited)`
      writeFileSync(path, JSON.stringify(doc))
      cli('connectors', 'update', id, '-f', path)
      check(cli('connectors', 'get', id).connector.display_name.endsWith('(edited)'), 'edit not saved')
    })
    await step('connectors disable / enable', () => {
      cli('connectors', 'disable', id)
      cli('connectors', 'enable', id)
    })
    await step('connectors delete', () => cli('connectors', 'delete', id, '--yes'))
  })
}

// ─── Decision tables ───

async function decisionTablesCli() {
  await flow('decision tables', 'CLI', async (step, cleanup) => {
    const { decision_table: table } = await step('decision-tables create', () => cli('decision-tables', 'create', '-f', file('dt-create', { name: `e2e cli dt ${RUN}`, ...DT_BODY })))
    cleanup(() => cli('decision-tables', 'delete', table.id, '--yes'))
    const path = await step('decision-tables get > dt.json', () => cliToFile('dt-get', 'decision-tables', 'get', table.id))
    await step('update -f unedited → changed:false', () => check(cli('decision-tables', 'update', table.id, '-f', path).changed === false, 'changed'))
    await step('edit rule output → update -f → test', () => {
      const doc = readJson(path)
      doc.decision_table.rules[0].outputs.discount = 15
      writeFileSync(path, JSON.stringify(doc))
      check(cli('decision-tables', 'update', table.id, '-f', path).changed === true, 'edit not reported')
      const tested = cli('decision-tables', 'test', table.id, '--set', 'values:={"amount":500}')
      check(tested.matched && Number(tested.outputs.discount) === 15, `test ${JSON.stringify(tested)}`)
    })
    await step('export → import (copy) → delete copy', () => {
      const exported = cliToFile('dt-export', 'decision-tables', 'export', table.id)
      const copy = cli('decision-tables', 'import', '-f', exported, '--set', `name_override=e2e dt copy ${RUN}`)
      cli('decision-tables', 'delete', copy.decision_table.id, '--yes')
    })
    await step('decision-tables delete', () => cli('decision-tables', 'delete', table.id, '--yes'))
  })
}

async function decisionTablesRest() {
  await flow('decision tables', 'REST', async (step, cleanup) => {
    const { decision_table: table } = await step('POST /decision-tables', () => rest('POST', '/decision-tables', { name: `e2e rest dt ${RUN}`, ...DT_BODY }))
    cleanup(() => rest('DELETE', `/decision-tables/${table.id}`))
    const got = await step('GET /decision-tables/{id}', () => rest('GET', `/decision-tables/${table.id}`))
    await step('PUT unedited → changed:false; PATCH edited', async () => {
      check((await rest('PUT', `/decision-tables/${table.id}`, got)).changed === false, 'changed')
      got.decision_table.name = `e2e rest dt ${RUN} (edited)`
      check((await rest('PATCH', `/decision-tables/${table.id}`, got)).changed === true, 'edit not reported')
    })
    await step('POST /test', async () => check((await rest('POST', `/decision-tables/${table.id}/test`, { values: { amount: 500 } })).matched, 'no match'))
    await step('GET /export → POST /import → DELETE copy', async () => {
      const exported = await rest('GET', `/decision-tables/${table.id}/export`)
      const copy = await rest('POST', '/decision-tables/import', { ...exported, name_override: `e2e dt copy ${RUN}` })
      await rest('DELETE', `/decision-tables/${copy.decision_table.id}`)
    })
    await step('DELETE /decision-tables/{id}', () => rest('DELETE', `/decision-tables/${table.id}`))
  })
}

async function decisionTablesMcp() {
  await flow('decision tables', 'MCP', async (step, cleanup) => {
    const { decision_table: table } = await step('decision_tables_create', () => mcp('decision_tables_create', { name: `e2e mcp dt ${RUN}`, ...DT_BODY }))
    cleanup(() => mcp('decision_tables_delete', { decision_table_id: table.id }))
    const { decision_table: got } = await step('decision_tables_get', () => mcp('decision_tables_get', { decision_table_id: table.id }))
    await step('decision_tables_update (get fields, unedited) → updated:false', async () => {
      check((await mcp('decision_tables_update', { decision_table_id: table.id, name: got.name, inputs: got.inputs, outputs: got.outputs, rules: got.rules })).updated === false, 'changed')
    })
    await step('decision_tables_update edited rules → test', async () => {
      got.rules[0].outputs.discount = 20
      check((await mcp('decision_tables_update', { decision_table_id: table.id, rules: got.rules })).updated === true, 'edit not reported')
      check(Number((await mcp('decision_tables_test', { decision_table_id: table.id, values: { amount: 500 } })).outputs.discount) === 20, 'test output')
    })
    await step('decision_tables_export → import → delete copy', async () => {
      const { export: doc } = await mcp('decision_tables_export', { decision_table_id: table.id })
      const { decision_table: copy } = await mcp('decision_tables_import', { import_json: JSON.stringify(doc), name_override: `e2e dt copy ${RUN}` })
      await mcp('decision_tables_delete', { decision_table_id: copy.id })
    })
    await step('decision_tables_delete', () => mcp('decision_tables_delete', { decision_table_id: table.id }))
  })
}

// ─── Email templates ───

const TEMPLATE = { subject: 'Hello {{name}}', html_body: '<p>Hello {{name}}</p>' }

async function emailTemplatesCli() {
  await flow('email templates', 'CLI', async (step, cleanup) => {
    const { email_template: tpl } = await step('email-templates create', () => cli('email-templates', 'create', '-f', file('tpl-create', { name: `e2e cli tpl ${RUN}`, ...TEMPLATE })))
    cleanup(() => cli('email-templates', 'delete', tpl.id, '--yes'))
    const path = await step('email-templates get > tpl.json', () => cliToFile('tpl-get', 'email-templates', 'get', tpl.id))
    await step('update -f unedited, then edited subject', () => {
      cli('email-templates', 'update', tpl.id, '-f', path)
      const doc = readJson(path)
      doc.email_template.subject = 'Welcome {{name}}'
      writeFileSync(path, JSON.stringify(doc))
      cli('email-templates', 'update', tpl.id, '-f', path)
      check(cli('email-templates', 'get', tpl.id).email_template.subject === 'Welcome {{name}}', 'edit not saved')
    })
    await step('email-templates preview', () => check(JSON.stringify(cli('email-templates', 'preview', tpl.id, '--set', 'variables:={"name":"Ada"}')).includes('Welcome Ada'), 'preview'))
    await step('email-templates delete', () => cli('email-templates', 'delete', tpl.id, '--yes'))
  })
}

async function emailTemplatesRest() {
  await flow('email templates', 'REST', async (step, cleanup) => {
    const { email_template: tpl } = await step('POST /email-templates', () => rest('POST', '/email-templates', { name: `e2e rest tpl ${RUN}`, ...TEMPLATE }))
    cleanup(() => rest('DELETE', `/email-templates/${tpl.id}`))
    const got = await step('GET /email-templates/{id}', () => rest('GET', `/email-templates/${tpl.id}`))
    await step('PATCH unedited, then edited', async () => {
      await rest('PATCH', `/email-templates/${tpl.id}`, got)
      got.email_template.subject = 'Welcome {{name}}'
      await rest('PATCH', `/email-templates/${tpl.id}`, got)
      check((await rest('GET', `/email-templates/${tpl.id}`)).email_template.subject === 'Welcome {{name}}', 'edit not saved')
    })
    await step('POST /preview', () => rest('POST', `/email-templates/${tpl.id}/preview`, { variables: { name: 'Ada' } }))
    await step('DELETE /email-templates/{id}', () => rest('DELETE', `/email-templates/${tpl.id}`))
  })
}

async function emailTemplatesMcp() {
  await flow('email templates', 'MCP', async (step, cleanup) => {
    const { email_template: tpl } = await step('email_templates_create', () => mcp('email_templates_create', { name: `e2e mcp tpl ${RUN}`, ...TEMPLATE }))
    cleanup(() => mcp('email_templates_delete', { email_template_id: tpl.id }))
    const { email_template: got } = await step('email_templates_get', () => mcp('email_templates_get', { email_template_id: tpl.id }))
    await step('email_templates_update edited subject → get', async () => {
      await mcp('email_templates_update', { email_template_id: tpl.id, name: got.name, subject: 'Welcome {{name}}' })
      check((await mcp('email_templates_get', { email_template_id: tpl.id })).email_template.subject === 'Welcome {{name}}', 'edit not saved')
    })
    await step('email_templates_preview', () => mcp('email_templates_preview', { email_template_id: tpl.id, variables: { name: 'Ada' } }))
    await step('email_templates_delete', () => mcp('email_templates_delete', { email_template_id: tpl.id }))
  })
}

// ─── Workflow activities ───

async function activitiesCli() {
  await flow('workflow activities', 'CLI', async (step, cleanup) => {
    const { workflow_activity: act } = await step('activities create', () => cli('activities', 'create', '-f', file('act-create', { name: `e2e cli act ${RUN}`, source_code: ACTIVITY_SOURCE, manifest: ACTIVITY_MANIFEST })))
    cleanup(() => cli('activities', 'delete', act.id, '--yes'))
    const path = await step('activities get > act.json', () => cliToFile('act-get', 'activities', 'get', act.id))
    await step('update -f unedited, then edited description + status', () => {
      cli('activities', 'update', act.id, '-f', path)
      const doc = readJson(path)
      doc.workflow_activity.description = 'edited by e2e'
      doc.workflow_activity.status = 'active'
      writeFileSync(path, JSON.stringify(doc))
      cli('activities', 'update', act.id, '-f', path)
      const after = cli('activities', 'get', act.id).workflow_activity
      check(after.description === 'edited by e2e' && after.status === 'active', 'edit not saved')
    })
    await step('activities export → import (copy) → delete copy', () => {
      const exported = cliToFile('act-export', 'activities', 'export', act.id)
      const doc = readJson(exported)
      doc.workflow_activity.name = `e2e act copy ${RUN}`
      doc.workflow_activity.key = `e2e_act_copy_${RUN}`
      writeFileSync(exported, JSON.stringify(doc))
      const copy = cli('activities', 'import', '-f', exported)
      cli('activities', 'delete', copy.workflow_activity.id, '--yes')
    })
    await step('activities delete', () => cli('activities', 'delete', act.id, '--yes'))
  })
}

async function activitiesRest() {
  await flow('workflow activities', 'REST', async (step, cleanup) => {
    const { workflow_activity: act } = await step('POST /workflow-activities', () => rest('POST', '/workflow-activities', { name: `e2e rest act ${RUN}`, source_code: ACTIVITY_SOURCE, manifest: ACTIVITY_MANIFEST }))
    cleanup(() => rest('DELETE', `/workflow-activities/${act.id}`))
    const got = await step('GET /workflow-activities/{id}', () => rest('GET', `/workflow-activities/${act.id}`))
    await step('PATCH unedited, then edited', async () => {
      await rest('PATCH', `/workflow-activities/${act.id}`, got)
      got.workflow_activity.description = 'edited by e2e'
      await rest('PATCH', `/workflow-activities/${act.id}`, got)
      check((await rest('GET', `/workflow-activities/${act.id}`)).workflow_activity.description === 'edited by e2e', 'edit not saved')
    })
    await step('GET /export', () => rest('GET', `/workflow-activities/${act.id}/export`))
    await step('DELETE /workflow-activities/{id}', () => rest('DELETE', `/workflow-activities/${act.id}`))
  })
}

async function activitiesMcp() {
  await flow('workflow activities', 'MCP', async (step, cleanup) => {
    const created = await step('workflow_activities_create', () => mcp('workflow_activities_create', { name: `e2e mcp act ${RUN}`, source_code: ACTIVITY_SOURCE, manifest: ACTIVITY_MANIFEST }))
    const id = (created.workflow_activity ?? created.activity ?? created).id
    cleanup(() => mcp('workflow_activities_delete', { workflow_activity_id: id }))
    await step('workflow_activities_get', () => mcp('workflow_activities_get', { workflow_activity_id: id }))
    await step('workflow_activities_update → get', async () => {
      await mcp('workflow_activities_update', { workflow_activity_id: id, description: 'edited by e2e' })
      const after = await mcp('workflow_activities_get', { workflow_activity_id: id })
      check((after.workflow_activity ?? after.activity ?? after).description === 'edited by e2e', 'edit not saved')
    })
    await step('workflow_activities_export', () => mcp('workflow_activities_export', { workflow_activity_id: id }))
    await step('workflow_activities_delete', () => mcp('workflow_activities_delete', { workflow_activity_id: id }))
  })
}

// ─── Remaining resources (CLI): a generic get → edit file → update → delete ───

interface GenericCase {
  resource: string
  command: string
  itemKey: string
  create: Record<string, unknown>
  /** Edit applied to the fetched item. */
  edit: (item: any) => void
  verify: (item: any) => boolean
  createArgs?: string[]
  deleteVerb?: string
  /** Read the id from the create response (default data[itemKey].id). */
  idOf?: (created: any) => string
}

async function genericCli(c: GenericCase) {
  await flow(c.resource, 'CLI', async (step, cleanup) => {
    const created = await step(`${c.command} create`, () => cli(c.command, 'create', ...(c.createArgs ?? []), '-f', file(`${c.command}-create`, c.create)))
    const id = c.idOf ? c.idOf(created) : created[c.itemKey].id
    cleanup(() => cli(c.command, c.deleteVerb ?? 'delete', id, '--yes'))
    const path = await step(`${c.command} get > file`, () => cliToFile(`${c.command}-get`, c.command, 'get', id))
    await step('update -f (unedited)', () => cli(c.command, 'update', id, '-f', path))
    await step('edit file → update -f → get', () => {
      const doc = readJson(path)
      c.edit(doc[c.itemKey])
      writeFileSync(path, JSON.stringify(doc))
      cli(c.command, 'update', id, '-f', path)
      check(c.verify(cli(c.command, 'get', id)[c.itemKey]), 'edit not saved')
    })
    await step(`${c.command} ${c.deleteVerb ?? 'delete'}`, () => cli(c.command, c.deleteVerb ?? 'delete', id, '--yes'))
  })
}

async function remainingCli() {
  await genericCli({
    resource: 'reports', command: 'reports', itemKey: 'report',
    create: { name: `e2e report ${RUN}`, config: { data_source: 'tasks', columns: [] } },
    edit: (r) => { r.description = 'edited by e2e' }, verify: (r) => r.description === 'edited by e2e',
  })
  await genericCli({
    resource: 'agents', command: 'agents', itemKey: 'agent',
    create: { name: `e2e agent ${RUN}`, system_prompt: 'Be brief.', model: 'claude-sonnet-4-5' },
    edit: (a) => { a.system_prompt = 'Be very brief.' }, verify: (a) => a.system_prompt === 'Be very brief.',
  })
  await genericCli({
    resource: 'retention policies', command: 'retention', itemKey: 'retention_policy',
    create: { name: `e2e retention ${RUN}`, policy_mode: 'review', duration_value: 30, duration_unit: 'days' },
    edit: (p) => { p.duration_value = 45 }, verify: (p) => Number(p.duration_value) === 45,
  })
  await genericCli({
    resource: 'roles', command: 'roles', itemKey: 'role',
    create: { name: `e2e role ${RUN}`, permissions: ['tasks.view_own'] },
    edit: (r) => { r.permissions = ['tasks.view_own', 'tasks.complete'] }, verify: (r) => r.permissions.includes('tasks.complete'),
  })
  await genericCli({
    resource: 'teams', command: 'teams', itemKey: 'team',
    create: { name: `e2e team ${RUN}` },
    edit: (t) => { t.description = 'edited by e2e' }, verify: (t) => t.description === 'edited by e2e',
  })

  // Webhooks hang off a workflow.
  await flow('webhooks', 'CLI', async (step, cleanup) => {
    const wf = await step('workflows create (host)', () => cli('workflows', 'create', '-f', file('wh-wf', { name: `e2e webhook host ${RUN}`, trigger_type: 'webhook_received', nodes: [{ id: 't', type: 'webhook_received', label: 'Webhook', position: { x: 0, y: 0 }, config: {} }] })))
    cleanup(() => cli('workflows', 'delete', wf.workflow_id, '--yes'))
    const created = await step('webhooks create', () => cli('webhooks', 'create', wf.workflow_id, '--set', `slug=e2e-${RUN}`))
    check(created.secret, 'no secret returned')
    const id = created.webhook.id
    cleanup(() => cli('webhooks', 'delete', id, '--yes'))
    await step('webhooks list', () => check(cli('webhooks', 'list', wf.workflow_id).webhooks.some((w: any) => w.id === id), 'not listed'))
    const path = await step('webhooks get > wh.json', () => cliToFile('wh-get', 'webhooks', 'get', id))
    await step('update -f unedited → changed:false; edit → changed', () => {
      check(cli('webhooks', 'update', id, '-f', path).changed === false, 'changed')
      const doc = readJson(path)
      doc.webhook.is_active = false
      doc.webhook.payload_mapping = [{ incoming_field: 'order.id', variable_name: 'order_id', type: 'string' }]
      writeFileSync(path, JSON.stringify(doc))
      check(cli('webhooks', 'update', id, '-f', path).changed === true, 'edit not reported')
      check(cli('webhooks', 'get', id).webhook.is_active === false, 'edit not saved')
    })
    await step('webhooks rotate', () => check(cli('webhooks', 'rotate', id).secret !== created.secret, 'secret unchanged'))
    await step('webhooks delete', () => cli('webhooks', 'delete', id, '--yes'))
  })

  // API keys are immutable by design: create → list → revoke → delete.
  await flow('api keys', 'CLI', async (step, cleanup) => {
    const created = await step('api-keys create', () => cli('api-keys', 'create', '--set', `name=e2e key ${RUN}`, '--set', 'expires_in_days:=1', '--set', 'permissions:=["workflows.view"]'))
    const id = created.api_key.id
    cleanup(() => cli('api-keys', 'delete', id, '--yes'))
    await step('api-keys list', () => check(cli('api-keys', 'list').api_keys.some((k: any) => k.id === id), 'not listed'))
    await step('api-keys revoke', () => cli('api-keys', 'revoke', id, '--yes'))
    await step('api-keys delete', () => cli('api-keys', 'delete', id, '--yes'))
  })
}

/** Unedited round trips must leave config-as-code with nothing to apply. */
async function configPlanUnchanged() {
  await flow('config plan', 'CLI', async (step, cleanup) => {
    const { decision_table: table } = await step('create a decision table + template', () => cli('decision-tables', 'create', '-f', file('plan-dt', { name: `e2e plan dt ${RUN}`, ...DT_BODY })))
    cleanup(() => cli('decision-tables', 'delete', table.id, '--yes'))
    const { email_template: tpl } = cli('email-templates', 'create', '-f', file('plan-tpl', { name: `e2e plan tpl ${RUN}`, ...TEMPLATE }))
    cleanup(() => cli('email-templates', 'delete', tpl.id, '--yes'))
    const dir = join(WORK, `${RUN}-config`)
    await step('config export', () => cli('config', 'export', dir, '--types', 'decision_tables,email_templates'))
    await step('get → update -f unedited (both)', () => {
      cli('decision-tables', 'update', table.id, '-f', cliToFile('plan-dt-get', 'decision-tables', 'get', table.id))
      cli('email-templates', 'update', tpl.id, '-f', cliToFile('plan-tpl-get', 'email-templates', 'get', tpl.id))
    })
    await step('config diff --exit-code → no changes', () => cli('config', 'diff', dir, '--exit-code'))
  })
}

async function main() {
  console.log(`e2e-surfaces against ${BASE} (CLI: ${existsSync(CLI_BIN) ? CLI_BIN : 'tsx source'})`)
  await workflowsCli()
  await workflowsRest()
  await workflowsMcp()
  await integrationsCli()
  await integrationsRest()
  await integrationsMcp()
  await referencesCli()
  await dataTablesAndObjectsCli()
  await connectorsCli()
  await decisionTablesCli()
  await decisionTablesRest()
  await decisionTablesMcp()
  await emailTemplatesCli()
  await emailTemplatesRest()
  await emailTemplatesMcp()
  await activitiesCli()
  await activitiesRest()
  await activitiesMcp()
  await remainingCli()
  await configPlanUnchanged()

  const resources = [...new Set(results.map((r) => r.resource))]
  const cellFor = (resource: string, surface: Surface) => {
    const r = results.find((x) => x.resource === resource && x.surface === surface)
    return r ? (r.ok ? `PASS (${r.steps})` : 'FAIL') : '-'
  }
  console.log('\nresource'.padEnd(22) + 'CLI'.padEnd(12) + 'REST'.padEnd(12) + 'MCP')
  for (const resource of resources) {
    console.log(resource.padEnd(21) + cellFor(resource, 'CLI').padEnd(12) + cellFor(resource, 'REST').padEnd(12) + cellFor(resource, 'MCP'))
  }
  const failed = results.filter((r) => !r.ok)
  for (const f of failed) console.log(`\nFAIL ${f.resource} [${f.surface}] ${f.failure}`)
  rmSync(WORK, { recursive: true, force: true })
  process.exit(failed.length ? 1 : 0)
}

void main()
