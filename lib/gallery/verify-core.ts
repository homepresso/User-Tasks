/**
 * Headless verification of a gallery package (official or community): the
 * engine behind `npm run gallery:verify` and the moderation queue's
 * re-verification. It installs the package into a scratch workspace kept
 * incomplete, completes setup against a mock API built from the package's
 * own response models (every reference answers with its response-model
 * sample; AI integrations with a canned chat completion), starts the entry
 * workflow with the sample input — or submits the entry form, the way people
 * start it — and checks the run reaches what is expected: waiting on a User
 * Task assigned to the scratch owner, or completed.
 *
 * Node only. It does not change process settings: the caller decides
 * whether private egress (the mock on 127.0.0.1) and a console email
 * provider are in force (the CLI sets both for its own process).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role client and free-form manifests */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PackageContents } from '@/lib/packages/build'
import type { GalleryMeta } from './types'

export type VerifyMeta = Pick<GalleryMeta, 'entry_workflow' | 'entry_form' | 'sample_input' | 'expect' | 'verify_mocks'>

export interface VerifyPackageInput {
  slug: string
  trigger: string
  fileName: string
  bytes: Uint8Array
  contents: PackageContents
  meta: VerifyMeta
}

export interface MockRoute { slug: string; integration: string; method: string; pattern: RegExp; name: string; sample: unknown; status: number }
export interface MockAgent { slug: string; integration: string; outputs: Record<string, unknown>; response: string }

export const shortId = (id: string) => String(id).replace(/-/g, '').slice(0, 8)

export function templateRegex(path: string): RegExp {
  const clean = String(path || '/').split('?')[0]
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '{' || ch === '}' ? ch : `\\${ch}`))
  return new RegExp(`^${escaped.replace(/\{\{[^}]+\}\}/g, '[^/]+').replace(/\/+$/, '')}/?$`)
}

/** A small Office template for document-node packages (find/replace placeholders like {{CUSTOMER}} work on its text). */
async function officeTemplate(name: string): Promise<{ type: string; body: Buffer } | null> {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('Sheet1')
    sheet.addRow(['Field', 'Value'])
    for (let i = 1; i <= 12; i++) sheet.addRow([`{{FIELD_${i}}}`, `{{VALUE_${i}}}`])
    return { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from(await book.xlsx.writeBuffer()) }
  }
  if (ext !== 'docx' && ext !== 'pptx') return null
  const PizZip = (await import('pizzip')).default
  const zip = new PizZip()
  if (ext === 'docx') {
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    const paragraphs = ['{{TITLE}}', '{{CUSTOMER}}', '{{DATE}}', '{{AMOUNT}}', '{{REFERENCE}}', '{{BODY}}'].map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`)
    return { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: zip.generate({ type: 'nodebuffer' }) }
  }
  return null
}

export function startMock(routes: MockRoute[], agents: MockAgent[], hits: Map<string, string[]>) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    for await (const _chunk of req) { /* drain */ }
    const url = new URL(req.url ?? '/', 'http://mock')
    const fileMatch = url.pathname.match(/^\/files\/([^/]+)\/([^/]+)$/)
    if (fileMatch) {
      const file = await officeTemplate(fileMatch[2])
      hits.set(fileMatch[1], [...(hits.get(fileMatch[1]) ?? []), `GET /files/${fileMatch[2]}`])
      if (!file) return send(404, { error: 'unknown template type' })
      res.writeHead(200, { 'content-type': file.type, 'content-length': String(file.body.byteLength) })
      return res.end(file.body)
    }
    const match = url.pathname.match(/^\/m\/([^/]+)\/([0-9a-f]{8})(\/.*)?$/)
    if (!match) return send(404, { error: 'unknown mock path' })
    const [, slug, integration, rest = '/'] = match
    const log = (line: string) => hits.set(slug, [...(hits.get(slug) ?? []), line])
    if (!/^Bearer \S+|^Basic \S+/.test(String(req.headers.authorization ?? '')) && !req.headers['x-api-key']) log(`! ${req.method} ${rest} without credentials`)
    const agent = agents.find((a) => a.slug === slug && a.integration === integration)
    if (agent && rest.endsWith('/chat/completions')) {
      log(`${req.method} ${rest} (agent)`)
      return send(200, {
        id: 'chatcmpl-gallery', object: 'chat.completion', model: 'mock',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: `${agent.response}\n\n\`\`\`json\n${JSON.stringify(agent.outputs)}\n\`\`\`` } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      })
    }
    const route = routes.find((r) => r.slug === slug && r.integration === integration && r.method === req.method && r.pattern.test(rest))
    if (!route) { log(`✗ ${req.method} ${rest}`); return send(404, { error: `No mock for ${req.method} ${rest}` }) }
    log(`${req.method} ${rest} → ${route.name}`)
    return send(route.status, route.sample ?? {})
  })
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    server.listen(Number(process.env.GALLERY_MOCK_PORT ?? 0), '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

/**
 * Tables whose tenant (or user) foreign keys do not cascade, in a safe
 * delete order: emptied first so the owner and the tenant row can go.
 */
export const NON_CASCADING = [
  'task_reminders', 'task_escalations', 'task_responses', 'task_assignees', 'task_dependencies', 'tasks', 'agent_queue', 'agent_runs', 'agents',
  'workflow_logs', 'workflow_queue', 'workflow_runs', 'workflow_versions', 'workflows', 'custom_table_rows', 'custom_tables',
  'integration_references', 'integrations', 'object_permissions', 'api_keys',
]

/** Delete the scratch workspace and its owner; returns an error message, or null when it is gone. */
export async function deleteScratchTenant(db: any, tenantId: string): Promise<string | null> {
  const { data: users } = await db.from('users').select('id').eq('tenant_id', tenantId)
  for (const table of NON_CASCADING) await db.from(table).delete().eq('tenant_id', tenantId)
  await db.from('users').delete().eq('tenant_id', tenantId)
  const { error } = await db.from('tenants').delete().eq('id', tenantId)
  for (const user of users ?? []) await db.auth.admin.deleteUser(user.id).catch(() => {})
  return error ? error.message : null
}

export interface VerifyResult {
  slug: string
  trigger: string
  native?: boolean
  installed: string
  completed: string
  run: string
  expected: string
  detail: string
  calls: number
  ok: boolean
}


/** Mock routes for one package's references and agents. */
export function mockRoutesFor(pkg: Pick<VerifyPackageInput, 'slug' | 'contents' | 'meta'>): { routes: MockRoute[]; agents: MockAgent[] } {
  const routes: MockRoute[] = []
  const agents: MockAgent[] = []
  for (const reference of (pkg.contents.assets as any).references ?? []) {
    const method = String(reference.request_config?.method ?? 'GET').toUpperCase()
    routes.push({
      slug: pkg.slug, integration: shortId(reference.integration_id), method, name: String(reference.name),
      pattern: templateRegex(String(reference.request_config?.path_template ?? '/')),
      sample: reference.request_config?.response_schema?.sample ?? {}, status: method === 'POST' ? 201 : 200,
    })
  }
  for (const agent of (pkg.contents.assets as any).agents ?? []) {
    const outputs: Record<string, unknown> = {}
    for (const v of agent.output_config?.variables ?? []) outputs[v.name] = (pkg.meta.verify_mocks?.agent_outputs as any)?.[v.name] ?? (v.type === 'number' ? 1 : v.type === 'boolean' ? false : `mock ${v.name}`)
    agents.push({ slug: pkg.slug, integration: shortId(agent.integration_id), outputs, response: 'Mock model response.' })
  }
  return { routes, agents }
}

export interface ScratchWorkspace {
  tenantId: string
  ownerId: string
  email: string
  slug: string
  ctx: any
}

/** A throw-away workspace (gallery-verify-*) whose owner has every permission. */
export async function createScratchWorkspace(db: any, label = 'Gallery Verify'): Promise<ScratchWorkspace> {
  const { provisionTenant } = await import('@/lib/tenant-provisioning')
  const { PERMISSION_KEYS } = await import('@/lib/permissions')
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const email = `gallery-verify+${stamp}@gallery-verify.example`
  const provisioned = await provisionTenant(db, { fullName: label, email, password: `gv-${stamp}-${Math.random().toString(36).slice(2)}`, company: `Gallery Verify ${stamp}`, onboardingCompleted: true })
  if (!provisioned.ok) throw new Error(`provisionTenant: ${JSON.stringify(provisioned)}`)
  const ctx: any = { supabase: db, db, tenantId: provisioned.tenantId, actorId: provisioned.userId, permissions: new Set(PERMISSION_KEYS), authKind: 'session', source: 'api' }
  return { tenantId: provisioned.tenantId, ownerId: provisioned.userId, email, slug: provisioned.slug, ctx }
}

/** Install, complete, start and check one package inside a scratch workspace. Never throws. */
export async function verifyPackage(db: any, scratch: ScratchWorkspace, mock: { url: string }, hits: Map<string, string[]>, entry: { slug: string; trigger: string; file_name: string }, bytes: Uint8Array, contents: PackageContents, meta: VerifyMeta): Promise<VerifyResult> {
  const { installPackage, completePackageInstall, getPackageInstall } = await import('@/lib/services/package-installs')
  const { startWorkflow } = await import('@/lib/services/workflow-start')
  const { submitForm } = await import('@/lib/services/form-submissions')
  const { processWorkflowQueueBatch } = await import('@/lib/workflow-queue-processor')
  const { isNativeContents } = await import('./build')
  const { ctx, tenantId, ownerId, email } = scratch
  const result: VerifyResult = { slug: entry.slug, trigger: entry.trigger, installed: '-', completed: '-', run: '-', expected: meta.expect, detail: '', calls: 0, ok: false }
    try {
    const file = Buffer.from(bytes).toString('base64')
    const installed: any = await installPackage(ctx, { file, keep_incomplete: true, source: 'file', source_label: entry.file_name } as any)
    result.installed = installed.install?.status ?? 'installed'
    const install = installed.install
    const native = isNativeContents(contents)
    result.native = native
    if (native && result.installed !== 'complete') throw new Error(`a "No integrations needed" package must install complete with zero requirements (status ${result.installed})`)

    // Requirement values: mock endpoints, mock credentials, the owner as every assignee.
    const values: Record<string, Record<string, unknown>> = {}
    for (const requirement of contents.requirements) {
      for (const field of requirement.fields) {
        let value: unknown
        if (requirement.kind === 'integration_auth' && field.key === 'config.base_url') value = `${mock.url}/m/${entry.slug}/${shortId(requirement.ref.asset_id)}`
        else if (requirement.kind === 'integration_auth' && field.secret) value = `gallery-mock-${field.key.split('.').pop()}`
        else if (requirement.kind === 'user') value = email
        else if (requirement.kind === 'env' || requirement.kind === 'secret') value = 'gallery-mock-value'
        if (value !== undefined) (values[requirement.id] ??= {})[field.key] = value
      }
    }
    const completed: any = await completePackageInstall(ctx, install.id, { values })
    result.completed = completed.status
    if (completed.status !== 'complete') throw new Error(`setup incomplete: ${completed.requirements.filter((r: any) => r.status === 'missing').map((r: any) => r.label).join(', ')}`)

    const detail: any = await getPackageInstall(ctx, install.id)
    const local = detail.assets.find((a: any) => a.section === 'workflows' && a.source_id === meta.entry_workflow)
    if (!local) throw new Error('entry workflow was not installed')
    const { data: wf } = await db.from('workflows').select('id, is_active, published_version_id').eq('id', local.local_id).single()
    if (!wf?.is_active) throw new Error('entry workflow is not active after Complete setup')

    // Every installed workflow's sub-workflow calls point at a workflow installed here.
    const localWorkflowIds = detail.assets.filter((a: any) => a.section === 'workflows').map((a: any) => String(a.local_id))
    const { data: installedWorkflows } = await db.from('workflows').select('id, name, nodes').in('id', localWorkflowIds)
    for (const row of installedWorkflows ?? []) {
      for (const node of row.nodes ?? []) {
        if (node?.type === 'call_sub_workflow' && !localWorkflowIds.includes(String(node.config?.sub_workflow_id))) throw new Error(`${row.name}: "${node.label}" calls a workflow that was not remapped (${node.config?.sub_workflow_id})`)
      }
    }
    // "$owner" in sample_input = the scratch owner (Person fields that route a step).
    const owned = (value: unknown): unknown => value === '$owner' ? ownerId : Array.isArray(value) ? value.map(owned) : value
    const input: Record<string, unknown> = Object.fromEntries(Object.entries(meta.sample_input ?? {}).map(([k, v]) => [k, owned(v)]))
    for (const [key, name] of Object.entries(meta.verify_mocks?.files ?? {})) input[key] = `${mock.url}/files/${entry.slug}/${name}`
    // Form-started packages run the way people start them: the form is submitted
    // (its Form submitted trigger or its Start workflow button queues the run).
    const { data: entryRow } = await db.from('workflows').select('nodes').eq('id', wf.id).single()
    const formTrigger = (entryRow?.nodes ?? []).find((n: any) => n?.type === 'form_submitted')
    const entryFormSource = meta.entry_form ?? (formTrigger ? contents.assets.workflows.find((w: any) => w.id === meta.entry_workflow)?.nodes?.find((n: any) => n.type === 'form_submitted')?.config?.form_id : null)
    let run: any
    if (entryFormSource) {
      const localForm = detail.assets.find((a: any) => a.section === 'forms' && a.source_id === entryFormSource)
      if (!localForm) throw new Error('the entry form was not installed')
      const submitted: any = await submitForm(ctx, localForm.local_id, { values: input, button_id: meta.verify_mocks?.button ?? null }, { source: 'api' })
      const screen = submitted.effects?.success_screen?.title
      result.detail = `form submitted${screen ? ` → "${String(screen).slice(0, 40)}"` : ''} · `
      let row: any = null
      for (let i = 0; i < 60 && !row; i++) {
        const { data } = await db.from('workflow_runs').select('id, status, error, node_results').eq('workflow_id', wf.id).order('started_at', { ascending: false }).limit(1)
        row = data?.[0] && data[0].status !== 'running' ? data[0] : null
        if (!row) {
          if (i % 10 === 5) await processWorkflowQueueBatch({ batchSize: 5 }).catch(() => {})
          await new Promise((r) => setTimeout(r, 500))
        }
      }
      if (!row) throw new Error('submitting the form did not start the entry workflow')
      run = { status: row.status === 'waiting' ? 'waiting' : row.status, run_id: row.id, error: row.error, node_results: row.node_results }
    } else {
      run = await startWorkflow(ctx, { workflow_id: wf.id, variables: input })
    }
    result.run = String(run.status)
    if (run.error) result.detail += String(run.error).slice(0, 160)
    if (meta.expect === 'waiting') {
      const { data: tasks } = await db.from('tasks').select('id, title, assignee_id, metadata').eq('tenant_id', tenantId).eq('workflow_id', wf.id).order('created_at', { ascending: false }).limit(1)
      const task = tasks?.[0]
      const waiting = /waiting/.test(result.run)
      if (waiting && task) {
        result.detail += `task "${String(task.title).slice(0, 60)}"${task.assignee_id === ownerId ? ' → owner' : ' (unassigned)'} · ${(task.metadata?.fields ?? []).length} fields${task.metadata?.form_buttons ? ' · buttons' : ''}${task.metadata?.form_layout ? ' · grid' : ''}`
        result.ok = task.assignee_id === ownerId
        if (!result.ok) result.detail += ' — expected the install-time assignee'
      } else if (waiting) {
        // Waiting on something else first (a delay / an event): still a sensible state.
        result.detail ||= 'waiting (no task yet)'
        result.ok = false
      } else {
        result.detail ||= `expected a waiting User Task, run ${result.run}`
      }
    } else {
      result.ok = result.run === 'completed'
      if (!result.ok && !result.detail) result.detail = `expected completed, run ${result.run}`
      if (result.ok) {
        const { data: runRow } = await db.from('workflow_runs').select('node_results').eq('id', run.run_id).maybeSingle()
        result.detail += `${Object.keys(runRow?.node_results ?? run.node_results ?? {}).length} steps`
      }
    }
    // Steps that errored (a step marked "continue on error" may; any other may not).
    {
      const runId = run.run_id
      const { data: runRow } = runId ? await db.from('workflow_runs').select('node_results').eq('id', runId).maybeSingle() : { data: null }
      const results = (runRow?.node_results ?? run.node_results ?? {}) as Record<string, any>
      const byId = new Map(((entryRow?.nodes ?? []) as any[]).map((n) => [String(n.id), n]))
      const errored = Object.entries(results).filter(([, r]) => r?.status === 'error' || r?.status === 'failed')
      const hard = errored.filter(([id]) => byId.get(id)?.onError !== 'continue')
      if (errored.length) result.detail += ` · ${errored.length} step error${errored.length === 1 ? '' : 's'} (${errored.map(([id, r]) => `${byId.get(id)?.label ?? id}: ${String(r?.error ?? '').slice(0, 80)}`).join('; ')})`
      if (hard.length) result.ok = false
    }
    // Async sub-workflows the run fired: wait for them to settle (they run in this process) and report them.
    const children = localWorkflowIds.filter((id: string) => id !== wf.id)
    if (children.length) {
      let subRuns: any[] = []
      for (let i = 0; i < 40; i++) {
        const { data } = await db.from('workflow_runs').select('id, status, error').in('workflow_id', children)
        subRuns = data ?? []
        if (subRuns.length && subRuns.every((r: any) => r.status !== 'running')) break
        await new Promise((r) => setTimeout(r, 500))
      }
      if (subRuns.length) {
        const counts = subRuns.reduce((acc: Record<string, number>, r: any) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
        result.detail += ` · sub-runs ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`
        const failed = subRuns.filter((r: any) => r.status === 'failed')
        if (failed.length) { result.ok = false; result.detail += ` (${String(failed[0].error ?? '').slice(0, 100)})` }
      }
    }
    const calls = hits.get(entry.slug) ?? []
    result.calls = calls.filter((c) => !c.startsWith('✗') && !c.startsWith('!')).length
    const misses = calls.filter((c) => c.startsWith('✗') || c.startsWith('!'))
    if (misses.length) { result.ok = false; result.detail += ` · mock misses: ${misses.join(', ')}` }
  } catch (error) {
    result.detail = (error instanceof Error ? error.message : String(error)).slice(0, 240)
    result.ok = false
  }
  return result
}

/**
 * Verify packages end to end in one scratch workspace with one mock server
 * (deleted afterwards unless `keep`). `onResult` is called as each finishes.
 */
export async function verifyPackagesHeadless(db: any, packages: VerifyPackageInput[], options: { keep?: boolean; log?: (line: string) => void; onResult?: (result: VerifyResult) => void } = {}): Promise<{ results: VerifyResult[]; workspace: ScratchWorkspace }> {
  const log = options.log ?? (() => {})
  const routes: MockRoute[] = []
  const agents: MockAgent[] = []
  for (const pkg of packages) {
    const found = mockRoutesFor(pkg)
    routes.push(...found.routes)
    agents.push(...found.agents)
  }
  const hits = new Map<string, string[]>()
  const mock = await startMock(routes, agents, hits)
  log(`mock API on ${mock.url} (${routes.length} reference routes, ${agents.length} agents)`)
  let scratch: ScratchWorkspace
  try {
    scratch = await createScratchWorkspace(db)
  } catch (error) {
    mock.close()
    throw error
  }
  log(`scratch workspace ${scratch.slug} (${scratch.tenantId})`)
  const results: VerifyResult[] = []
  try {
    for (const pkg of packages) {
      const result = await verifyPackage(db, scratch, mock, hits, { slug: pkg.slug, trigger: pkg.trigger, file_name: pkg.fileName }, pkg.bytes, pkg.contents, pkg.meta)
      results.push(result)
      options.onResult?.(result)
    }
  } finally {
    mock.close()
    if (!options.keep) {
      const left = await deleteScratchTenant(db, scratch.tenantId)
      log(left ? `! scratch workspace ${scratch.tenantId} could not be deleted: ${left}` : 'scratch workspace deleted')
    } else {
      log(`kept scratch workspace ${scratch.slug} (owner ${scratch.email})`)
    }
  }
  return { results, workspace: scratch }
}
