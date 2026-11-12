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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { PackageContents } from '@/lib/packages/build'
import { mediaProviderForType } from '@/lib/media/catalog'
import { geminiMockAnswer, isGeminiGenerate, type MediaMockOptions } from './media-mock'
import type { GalleryKind, GalleryMeta } from './types'

export type VerifyMeta = Pick<GalleryMeta, 'entry_workflow' | 'entry_form' | 'sample_input' | 'expect' | 'verify_mocks'>

export interface VerifyPackageInput {
  slug: string
  trigger: string
  fileName: string
  bytes: Uint8Array
  contents: PackageContents
  meta: VerifyMeta
  /** form_control / control_bundle: verified by verifyControlPackage (no workflow to run). */
  kind?: GalleryKind
}

export interface MockRoute { slug: string; integration: string; method: string; pattern: RegExp; name: string; sample: unknown; status: number }
export interface MockAgent { slug: string; integration: string; outputs: Record<string, unknown>; response: string }
/** A media AI provider integration of a package: answered by the mock media provider (lib/gallery/media-mock.ts). */
export interface MockMedia { slug: string; integration: string; options: MediaMockOptions }

/** Synthetic sample media the verifier serves and uploads (gallery/samples/). */
export const GALLERY_SAMPLES_DIR = join(process.cwd(), 'gallery', 'samples')

const SAMPLE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** A sample file by name (no paths), or null. */
export function readGallerySample(name: string): { type: string; body: Buffer } | null {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || name.includes('..')) return null
  const file = join(GALLERY_SAMPLES_DIR, name)
  if (!existsSync(file)) return null
  return { type: SAMPLE_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream', body: readFileSync(file) }
}

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

export function startMock(routes: MockRoute[], agents: MockAgent[], hits: Map<string, string[]>, media: MockMedia[] = []) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const url = new URL(req.url ?? '/', 'http://mock')
    const fileMatch = url.pathname.match(/^\/files\/([^/]+)\/([^/]+)$/)
    if (fileMatch) {
      const file = readGallerySample(fileMatch[2]) ?? await officeTemplate(fileMatch[2])
      hits.set(fileMatch[1], [...(hits.get(fileMatch[1]) ?? []), `GET /files/${fileMatch[2]}`])
      if (!file) return send(404, { error: 'unknown template type' })
      res.writeHead(200, { 'content-type': file.type, 'content-length': String(file.body.byteLength) })
      return res.end(file.body)
    }
    const match = url.pathname.match(/^\/m\/([^/]+)\/([0-9a-f]{8})(\/.*)?$/)
    if (!match) return send(404, { error: 'unknown mock path' })
    const [, slug, integration, rest = '/'] = match
    const log = (line: string) => hits.set(slug, [...(hits.get(slug) ?? []), line])
    if (!/^Bearer \S+|^Basic \S+/.test(String(req.headers.authorization ?? '')) && !req.headers['x-api-key'] && !req.headers['x-goog-api-key']) log(`! ${req.method} ${rest} without credentials`)
    const mediaProvider = media.find((m) => m.slug === slug && m.integration === integration)
    if (mediaProvider) {
      if (!isGeminiGenerate(String(req.method), rest)) { log(`✗ ${req.method} ${rest} (media)`); return send(404, { error: { code: 404, message: `No media mock for ${req.method} ${rest}`, status: 'NOT_FOUND' } }) }
      let body: unknown = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* empty */ }
      log(`${req.method} ${rest} (media)`)
      return send(200, geminiMockAnswer(body, mediaProvider.options))
    }
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


/** Mock routes for one package's references, agents and media AI providers. */
export function mockRoutesFor(pkg: Pick<VerifyPackageInput, 'slug' | 'contents' | 'meta'>): { routes: MockRoute[]; agents: MockAgent[]; media: MockMedia[] } {
  const routes: MockRoute[] = []
  const agents: MockAgent[] = []
  const media: MockMedia[] = []
  for (const integration of (pkg.contents.assets as any).integrations ?? []) {
    if (mediaProviderForType(integration.type)) media.push({ slug: pkg.slug, integration: shortId(integration.id), options: pkg.meta.verify_mocks?.media ?? {} })
  }
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
  return { routes, agents, media }
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
  // The active auth provider's admin (Supabase Auth, or built-in auth on a
  // Supabase-free install), as first-run setup and the instance admin API use.
  const { getAuthProvider } = await import('@/lib/providers/auth')
  const { admin } = await getAuthProvider()
  const provisioned = await provisionTenant(db, { fullName: label, email, password: `gv-${stamp}-${Math.random().toString(36).slice(2)}`, company: `Gallery Verify ${stamp}`, onboardingCompleted: true }, admin)
  if (!provisioned.ok) throw new Error(`provisionTenant: ${JSON.stringify(provisioned)}`)
  const ctx: any = { supabase: db, db, tenantId: provisioned.tenantId, actorId: provisioned.userId, permissions: new Set(PERMISSION_KEYS), authKind: 'session', source: 'api' }
  return { tenantId: provisioned.tenantId, ownerId: provisioned.userId, email, slug: provisioned.slug, ctx }
}

/** Requirement values for a verification: mock endpoints, mock credentials, the owner as every assignee. */
export function mockRequirementValues(contents: PackageContents, mock: { url: string }, slug: string, email: string): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {}
  for (const requirement of contents.requirements) {
    for (const field of requirement.fields) {
      let value: unknown
      if (requirement.kind === 'integration_auth' && field.key === 'config.base_url') value = `${mock.url}/m/${slug}/${shortId(requirement.ref.asset_id)}`
      else if (requirement.kind === 'integration_auth' && field.secret) value = `gallery-mock-${field.key.split('.').pop()}`
      else if (requirement.kind === 'user') value = email
      else if (requirement.kind === 'env' || requirement.kind === 'secret') value = 'gallery-mock-value'
      if (value !== undefined) (values[requirement.id] ??= {})[field.key] = value
    }
  }
  return values
}

/**
 * A form control package (official gallery/controls): install it, complete
 * setup against the mock (the address control's Places integration), then
 * check every control landed in the library — enabled, at the packaged
 * version, the module byte-identical (SHA-256) and, for a signed package,
 * recorded as signed — and that the sample forms it ships installed with
 * their custom fields resolving to library controls; a lookup field on a
 * sample form is queried through the real lookup service (→ the mock API).
 */
export async function verifyControlPackage(db: any, scratch: ScratchWorkspace, mock: { url: string }, hits: Map<string, string[]>, entry: { slug: string; file_name: string }, bytes: Uint8Array, contents: PackageContents, signed: boolean): Promise<VerifyResult> {
  const { installPackage, completePackageInstall, getPackageInstall } = await import('@/lib/services/package-installs')
  const { lookupFormField } = await import('@/lib/services/form-lookup')
  const { sha256Hex } = await import('@/lib/forms/custom-controls/package')
  const { ctx, tenantId, email } = scratch
  const result: VerifyResult = { slug: entry.slug, trigger: 'control', installed: '-', completed: '-', run: 'n/a', expected: 'installed', detail: '', calls: 0, ok: false }
  try {
    const installed: any = await installPackage(ctx, { file: Buffer.from(bytes).toString('base64'), keep_incomplete: true, source: 'file', source_label: entry.file_name } as any)
    result.installed = installed.install?.status ?? 'installed'
    result.native = contents.requirements.length === 0
    let status = result.installed
    if (contents.requirements.length) {
      const completed: any = await completePackageInstall(ctx, installed.install.id, { values: mockRequirementValues(contents, mock, entry.slug, email) })
      status = completed.status
    }
    result.completed = status
    if (status !== 'complete') throw new Error(`setup incomplete (${status})`)
    const notes: string[] = []
    for (const control of (contents.assets as any).form_controls ?? []) {
      const { data: row } = await db.from('form_controls').select('id, tag, enabled, latest_version').eq('tenant_id', tenantId).eq('tag', control.tag).maybeSingle()
      if (!row) throw new Error(`${control.tag} is not in the form control library`)
      if (!row.enabled) throw new Error(`${control.tag} is disabled after install`)
      for (const version of control.versions ?? []) {
        const { data: v } = await db.from('form_control_versions').select('sha256, size_bytes, signature').eq('control_id', row.id).eq('version', version.version).maybeSingle()
        if (!v) throw new Error(`${control.tag} ${version.version} was not stored`)
        if (v.sha256 !== sha256Hex(String(version.bundle))) throw new Error(`${control.tag} ${version.version}: the stored module differs from the package`)
        if (signed && !v.signature?.verified) throw new Error(`${control.tag} ${version.version}: the package is signed but the version records no signature`)
      }
      notes.push(`${control.tag}@${row.latest_version}${signed ? ' signed' : ''}`)
    }
    const detail: any = await getPackageInstall(ctx, installed.install.id)
    for (const form of (contents.assets as any).forms ?? []) {
      const local = detail.assets.find((a: any) => a.section === 'forms' && a.source_id === form.id)
      if (!local) throw new Error(`the sample form "${form.name}" was not installed`)
      const { data: stored } = await db.from('forms').select('fields').eq('id', local.local_id).single()
      for (const field of (stored?.fields ?? []) as any[]) {
        if (field?.type !== 'custom') continue
        const { data: lib } = await db.from('form_controls').select('id').eq('tenant_id', tenantId).eq('tag', field.custom?.tag).maybeSingle()
        if (!lib) throw new Error(`form "${form.name}": field "${field.key}" uses ${field.custom?.tag}, which is not installed`)
        if (field.lookup?.source === 'reference') {
          const found = await lookupFormField(ctx, local.local_id, { field_key: field.key, query: 'Main Street' })
          if (!found.items.length) throw new Error(`form "${form.name}": the "${field.key}" lookup returned nothing`)
          notes.push(`${field.key} lookup → ${found.items.length} suggestion${found.items.length === 1 ? '' : 's'} (${String(found.items[0].label).slice(0, 40)})`)
        }
      }
      notes.push(`form "${form.name}"`)
    }
    result.detail = notes.join(' · ')
    const calls = hits.get(entry.slug) ?? []
    result.calls = calls.filter((c) => !c.startsWith('✗') && !c.startsWith('!')).length
    const misses = calls.filter((c) => c.startsWith('✗') || c.startsWith('!'))
    if (misses.length) throw new Error(`mock misses: ${misses.join(', ')}`)
    result.ok = true
  } catch (error) {
    result.detail = (error instanceof Error ? error.message : String(error)).slice(0, 240)
    result.ok = false
  }
  return result
}

/**
 * A workflow action package (official gallery/actions): install it like a
 * workflow package and run its sample workflow (it must complete, every
 * custom action step with outputs), then check the action landed in
 * Extensibility — enabled, the packaged version, the module byte-identical
 * (SHA-256), a version record and, for a signed package, the signer.
 */
export async function verifyActionPackage(db: any, scratch: ScratchWorkspace, mock: { url: string }, hits: Map<string, string[]>, entry: { slug: string; file_name: string }, bytes: Uint8Array, contents: PackageContents, signed: boolean): Promise<VerifyResult> {
  const { sha256Hex } = await import('@/lib/forms/custom-controls/package')
  const workflows = ((contents.assets as any).workflows ?? []) as any[]
  const sample = workflows.find((w) => (w.nodes ?? []).some((n: any) => n?.type === 'custom_activity')) ?? workflows[0]
  const result: VerifyResult = sample
    ? await verifyPackage(db, scratch, mock, hits, { slug: entry.slug, trigger: 'action', file_name: entry.file_name }, bytes, contents, { entry_workflow: String(sample.id), sample_input: {}, expect: 'completed' } as VerifyMeta, {
      // Declared secrets get the example value the gallery examples use (an admin sets real ones).
      beforeRun: async () => {
        const { setWorkflowActivitySecrets } = await import('@/lib/services/workflow-activities')
        const { hasEncryptionKey, installEncryptionKey } = await import('@/lib/secret-crypto')
        if (!hasEncryptionKey()) installEncryptionKey(randomBytes(32).toString('hex'))
        for (const activity of (contents.assets as any).workflow_activities ?? []) {
          const secrets = (activity.manifest?.capabilities?.credentials ?? []) as Array<{ name: string }>
          if (secrets.length) await setWorkflowActivitySecrets(scratch.ctx, activity.key, Object.fromEntries(secrets.map((x) => [x.name, 'example-secret'])))
        }
      },
    })
    : { slug: entry.slug, trigger: 'action', installed: '-', completed: '-', run: 'n/a', expected: 'completed', detail: 'no sample workflow', calls: 0, ok: false }
  result.trigger = 'action'
  if (!result.ok) return result
  try {
    const notes: string[] = []
    for (const activity of (contents.assets as any).workflow_activities ?? []) {
      const { data: row } = await db.from('custom_workflow_activities').select('id, key, version, enabled, runtime, sha256, signature').eq('tenant_id', scratch.tenantId).eq('key', activity.key).maybeSingle()
      if (!row) throw new Error(`${activity.key} is not in Extensibility`)
      if (row.enabled === false) throw new Error(`${activity.key} is disabled after install`)
      if (row.runtime !== 'module') throw new Error(`${activity.key} installed as a ${row.runtime} activity`)
      if (row.version !== activity.version) throw new Error(`${activity.key} is ${row.version}, the package has ${activity.version}`)
      if (row.sha256 !== sha256Hex(String(activity.source_code).trim())) throw new Error(`${activity.key}: the stored module differs from the package`)
      const { data: version } = await db.from('custom_workflow_activity_versions').select('sha256').eq('activity_id', row.id).eq('version', row.version).maybeSingle()
      if (!version) throw new Error(`${activity.key} ${row.version}: no version record`)
      if (signed && !row.signature?.verified) throw new Error(`${activity.key}: the package is signed but the action records no signature`)
      notes.push(`${activity.key}@${row.version}${signed ? ' signed' : ''}`)
    }
    // Every custom action step of the run succeeded with outputs.
    const { data: runs } = await db.from('workflow_runs').select('node_results').eq('tenant_id', scratch.tenantId).order('started_at', { ascending: false }).limit(1)
    const steps = Object.values((runs?.[0]?.node_results ?? {}) as Record<string, any>).filter((r) => r?.output?.activity_key)
    if (!steps.length) throw new Error('the sample run has no custom action step results')
    for (const step of steps) {
      if (step.status !== 'success' || !step.output?.output_count) throw new Error(`step ${step.output?.operation ?? '?'}: ${step.status}, ${step.output?.output_count ?? 0} outputs`)
    }
    result.detail += ` · ${notes.join(', ')} · ${steps.map((s) => `${s.output.operation} → ${s.output.output_count} outputs`).join(', ')}`
  } catch (error) {
    result.ok = false
    result.detail += ` · ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`
  }
  return result
}

/** Install, complete, start and check one package inside a scratch workspace. Never throws. */
export async function verifyPackage(db: any, scratch: ScratchWorkspace, mock: { url: string }, hits: Map<string, string[]>, entry: { slug: string; trigger: string; file_name: string }, bytes: Uint8Array, contents: PackageContents, meta: VerifyMeta, hooks: { beforeRun?: () => Promise<void> } = {}): Promise<VerifyResult> {
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

    const values = mockRequirementValues(contents, mock, entry.slug, email)
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
    // Workflow-scoped saved reports point at a workflow installed here (not the package's source id).
    const localReportIds = detail.assets.filter((a: any) => a.section === 'reports').map((a: any) => String(a.local_id))
    if (localReportIds.length) {
      const { data: installedReports } = await db.from('reports').select('id, name, config').in('id', localReportIds)
      for (const report of installedReports ?? []) {
        const scoped = report.config?.source_inputs?.workflow_id
        if (scoped && !localWorkflowIds.includes(String(scoped))) throw new Error(`report "${report.name}" points at a workflow that was not remapped (${scoped})`)
      }
    }
    await hooks.beforeRun?.()
    // "$owner" in sample_input = the scratch owner (Person fields that route a step).
    const owned = (value: unknown): unknown => value === '$owner' ? ownerId : Array.isArray(value) ? value.map(owned) : value
    const ownedValues = (values: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [k, owned(v)]))
    const input: Record<string, unknown> = ownedValues(meta.sample_input)
    for (const [key, name] of Object.entries(meta.verify_mocks?.files ?? {})) input[key] = `${mock.url}/files/${entry.slug}/${name}`
    // Sample files for attachments fields, uploaded the way the form / task page uploads them.
    const { uploadFormFile } = await import('@/lib/services/form-files')
    const upload = async (context: any, uploads: Record<string, string[]> | undefined, into: Record<string, unknown>) => {
      for (const [fieldKey, names] of Object.entries(uploads ?? {})) {
        const files: unknown[] = []
        for (const name of names) {
          const sample = readGallerySample(name)
          if (!sample) throw new Error(`sample file "${name}" is not in gallery/samples`)
          files.push(await uploadFormFile(ctx, { context, field_key: fieldKey, name, bytes: new Uint8Array(sample.body) }))
        }
        into[fieldKey] = files
      }
    }
    // Runs settle when they wait on something other than a background media job (or end);
    // media jobs, queued resumes and form starts are processed here, in this process.
    const { processMediaJobBatch, isMediaManagedEvent } = await import('@/lib/media/jobs')
    const settle = async (runId: string, leaving?: string | null) => {
      for (let i = 0; i < 480; i++) {
        const { data: row } = await db.from('workflow_runs').select('id, status, error, node_results, event_id, pause_variables').eq('id', runId).maybeSingle()
        const moved = !leaving || row?.event_id !== leaving || !/waiting/.test(String(row?.status))
        if (row && moved && row.status !== 'running' && !(/waiting/.test(row.status) && isMediaManagedEvent(row.event_id))) return row
        if (i % 2 === 1) {
          await processMediaJobBatch({ supabase: db, batchSize: 2 }).catch(() => {})
          await processWorkflowQueueBatch({ batchSize: 5 }).catch(() => {})
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      throw new Error(`run ${runId} did not settle (still running or waiting on a media job)`)
    }
    // Form-started packages run the way people start them: the form is submitted
    // (its Form submitted trigger or its Start workflow button queues the run).
    const { data: entryRow } = await db.from('workflows').select('nodes').eq('id', wf.id).single()
    const formTrigger = (entryRow?.nodes ?? []).find((n: any) => n?.type === 'form_submitted')
    const entryFormSource = meta.entry_form ?? (formTrigger ? contents.assets.workflows.find((w: any) => w.id === meta.entry_workflow)?.nodes?.find((n: any) => n.type === 'form_submitted')?.config?.form_id : null)
    let runId: string
    if (entryFormSource) {
      const localForm = detail.assets.find((a: any) => a.section === 'forms' && a.source_id === entryFormSource)
      if (!localForm) throw new Error('the entry form was not installed')
      await upload({ kind: 'form', formId: localForm.local_id }, meta.verify_mocks?.uploads, input)
      const submitted: any = await submitForm(ctx, localForm.local_id, { values: input, button_id: meta.verify_mocks?.button ?? null }, { source: 'api' })
      const screen = submitted.effects?.success_screen?.title
      result.detail = `form submitted${screen ? ` → "${String(screen).slice(0, 40)}"` : ''} · `
      let found: string | null = null
      for (let i = 0; i < 120 && !found; i++) {
        const { data } = await db.from('workflow_runs').select('id').eq('workflow_id', wf.id).order('started_at', { ascending: false }).limit(1)
        found = data?.[0]?.id ?? null
        if (!found) {
          if (i % 10 === 5) await processWorkflowQueueBatch({ batchSize: 5 }).catch(() => {})
          await new Promise((r) => setTimeout(r, 500))
        }
      }
      if (!found) throw new Error('submitting the form did not start the entry workflow')
      runId = found
    } else {
      const started: any = await startWorkflow(ctx, { workflow_id: wf.id, variables: input })
      runId = String(started.run_id)
    }
    let row: any = await settle(runId)
    // Tasks the verifier completes on the way (with sample files for attachments fields).
    const { completeWorkflowTaskAction } = await import('@/lib/services/task-actions')
    for (const [index, step] of (meta.verify_mocks?.tasks ?? []).entries()) {
      if (!/waiting/.test(String(row.status))) throw new Error(`task step ${index + 1}: the run is ${row.status}${row.error ? ` (${String(row.error).slice(0, 120)})` : ''}, not waiting on a task`)
      const { data: open } = await db.from('tasks').select('id, title, assignee_id').eq('tenant_id', tenantId).eq('event_id', row.event_id).limit(1)
      const task = open?.[0]
      if (!task) throw new Error(`task step ${index + 1}: no task for the run's wait`)
      const values = ownedValues(step.values)
      await upload({ kind: 'task', taskId: task.id }, step.uploads, values)
      const done: any = await completeWorkflowTaskAction(ctx, task.id, { outcome: step.outcome, values, buttonId: step.button ?? null }, { via: 'api' })
      if (done.status !== 'completed') throw new Error(`task "${task.title}": ${JSON.stringify(done.errors ?? done.status).slice(0, 160)}`)
      result.detail += `"${String(task.title).slice(0, 40)}" → ${step.outcome} · `
      row = await settle(runId, row.event_id)
    }
    const run: any = { status: row.status, run_id: row.id, error: row.error, node_results: row.node_results }
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
      if (result.ok) result.detail += `${Object.keys(run.node_results ?? {}).length} steps`
    }
    // Background media steps of the run (processed above, as the process-media job does).
    const { data: jobs } = await db.from('media_jobs').select('status').eq('run_id', row.id)
    if (jobs?.length) {
      result.detail += ` · media jobs ${jobs.filter((j: any) => j.status === 'completed').length}/${jobs.length} completed`
      if (jobs.some((j: any) => j.status === 'failed')) result.ok = false
    }
    // Outputs the run must have produced by now (redacted files, transcripts, …).
    const wanted = meta.verify_mocks?.expect_outputs ?? []
    if (wanted.length) {
      const vars = (row.pause_variables ?? {}) as Record<string, any>
      const valueAt = (path: string) => path.split('.').reduce((v: any, k) => (v && typeof v === 'object' ? v[k] : undefined), vars)
      // A finished run keeps no variables: a successful step that set the output (or its root) counts.
      const setBy = (name: string) => Object.values((row.node_results ?? {}) as Record<string, any>).some((r) => {
        const variable = String(r?.output?.variable ?? '')
        return r?.status === 'success' && variable && (name === variable || name.startsWith(`${variable}_`))
      })
      const missing = wanted.filter((name) => { const v = valueAt(name); return (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) && !(row.status === 'completed' && setBy(name)) })
      result.detail += ` · outputs ${wanted.length - missing.length}/${wanted.length}`
      if (missing.length) { result.ok = false; result.detail += ` (missing ${missing.join(', ')})` }
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

async function packageSigned(bytes: Uint8Array): Promise<boolean> {
  const { unpackPackage } = await import('@/lib/packages/format')
  const unpacked = unpackPackage(bytes)
  return Boolean(unpacked.verification.signed && unpacked.verification.signature_ok)
}

/**
 * Verify packages end to end in one scratch workspace with one mock server
 * (deleted afterwards unless `keep`). `onResult` is called as each finishes.
 */
export async function verifyPackagesHeadless(db: any, packages: VerifyPackageInput[], options: { keep?: boolean; log?: (line: string) => void; onResult?: (result: VerifyResult) => void } = {}): Promise<{ results: VerifyResult[]; workspace: ScratchWorkspace }> {
  const log = options.log ?? (() => {})
  const routes: MockRoute[] = []
  const agents: MockAgent[] = []
  const media: MockMedia[] = []
  for (const pkg of packages) {
    const found = mockRoutesFor(pkg)
    routes.push(...found.routes)
    agents.push(...found.agents)
    media.push(...found.media)
  }
  const hits = new Map<string, string[]>()
  const mock = await startMock(routes, agents, hits, media)
  log(`mock API on ${mock.url} (${routes.length} reference routes, ${agents.length} agents, ${media.length} media providers)`)
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
      const result = pkg.kind === 'workflow_action'
        ? await verifyActionPackage(db, scratch, mock, hits, { slug: pkg.slug, file_name: pkg.fileName }, pkg.bytes, pkg.contents, await packageSigned(pkg.bytes))
        : pkg.kind === 'form_control' || pkg.kind === 'control_bundle'
        ? await verifyControlPackage(db, scratch, mock, hits, { slug: pkg.slug, file_name: pkg.fileName }, pkg.bytes, pkg.contents, await packageSigned(pkg.bytes))
        : await verifyPackage(db, scratch, mock, hits, { slug: pkg.slug, trigger: pkg.trigger, file_name: pkg.fileName }, pkg.bytes, pkg.contents, pkg.meta)
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
