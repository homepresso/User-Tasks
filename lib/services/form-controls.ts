/**
 * Custom form controls (web components): the workspace library behind
 * Extensibility → Form controls, the designer palette, the frame route,
 * /api/v1/form-controls*, the MCP form_controls_* tools and config as code.
 *
 * A control is identified by its custom element tag (unique per
 * workspace). Every upload is an immutable semver version: the validated
 * manifest, the ES module snapshot (a URL import fetches it once, through
 * the egress guard — runtime never loads third-party URLs), its SHA-256 and
 * an optional signature. Re-uploading identical bytes for an existing
 * version is a no-op; different bytes for an existing version are refused.
 *
 * Permissions: extensibility.view (or forms.view: designers list enabled
 * controls), extensibility.create (new control), extensibility.edit (new
 * version, enable / disable, approved hosts), extensibility.delete. Marking
 * a control `trusted` (inline rendering, no sandbox) needs an instance
 * admin — the UI adapter checks that and passes `instanceAdmin`.
 * Deleting a control (or one version) that a form, workflow or open task
 * uses is refused with the usages. Writes go through a service-role client
 * with explicit tenant filters (the tables have no client write grants).
 */

import { FORM_NODE_TYPES } from '@/lib/forms/definition'
import { customControlRefs, workflowCustomControlRefs } from '@/lib/forms/custom-controls/field'
import { compareSemver, isSemver, isValidTag, latestVersion, normalizeHosts, parseFormControlManifest } from '@/lib/forms/custom-controls/manifest'
import { PACKAGE_LIMITS, type FormControlManifest } from '@/lib/forms/custom-controls/contract'
import { PackageError, parseControlUpload, parseZipPackage, parseModulePackage, sha256Hex, type ControlSignature, type ParsedControlPackage } from '@/lib/forms/custom-controls/package'
import { getDb, hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { applyPage, audit, dbError, ilikeTerm, serviceRoleClient, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables are not in the generated Database types */

const CONTROL_COLUMNS = 'id, tag, name, description, icon, latest_version, enabled, trusted, approved_hosts, created_by, updated_by, created_at, updated_at'
const VERSION_COLUMNS = 'id, control_id, version, manifest, sha256, size_bytes, source, source_url, signature, created_by, created_at'

export interface FormControlRow {
  id: string
  tag: string
  name: string
  description: string | null
  icon: string | null
  latest_version: string
  enabled: boolean
  trusted: boolean
  approved_hosts: string[]
  created_by?: string | null
  updated_by?: string | null
  created_at: string
  updated_at: string
}

export interface FormControlVersionRow {
  id: string
  control_id: string
  version: string
  manifest: FormControlManifest
  sha256: string
  size_bytes: number
  source: 'upload' | 'url' | 'import' | 'package'
  source_url: string | null
  signature: ControlSignature | null
  created_by: string | null
  created_at: string
}

export interface FormControlUsage {
  kind: 'form' | 'workflow' | 'task'
  id: string
  name: string
  /** form: the version's form number; workflow: draft / published; task: status. */
  where: string
  field_key: string
  version: string
}

export interface FormControlSummary extends FormControlRow {
  /** The latest version's manifest (palette, properties panel). */
  manifest: FormControlManifest | null
  versions: Array<Pick<FormControlVersionRow, 'id' | 'version' | 'sha256' | 'size_bytes' | 'source' | 'source_url' | 'signature' | 'created_at'>>
  /** Hosts the manifest asks for that an admin has not approved yet. */
  pending_hosts: string[]
}

export interface UploadInput {
  /** Zip package bytes. */
  zip?: Uint8Array | null
  /** Or a single ES module… */
  module?: string | null
  /** …and its manifest (JSON text or object). */
  manifest?: unknown
  signature?: unknown
}

export interface SaveResult {
  control: FormControlSummary
  version: string
  /** 'created' (new control), 'version' (new version), 'unchanged' (same bytes re-uploaded). */
  outcome: 'created' | 'version' | 'unchanged'
  warnings: string[]
}

function requireAny(ctx: ServiceContext, permissions: string[]): void {
  if (permissions.some((p) => hasPerm(ctx, p))) return
  throw ServiceError.forbidden(`Forbidden: needs one of ${permissions.map((p) => `'${p}'`).join(', ')}`)
}

function requireAll(ctx: ServiceContext, permission: string): void {
  if (hasPerm(ctx, permission)) return
  throw ServiceError.forbidden(`Forbidden: needs the '${permission}' permission`)
}

function packageError(error: unknown): never {
  if (error instanceof PackageError) throw ServiceError.validation(error.message)
  if (error instanceof Error && error.name === 'ManifestError') throw ServiceError.validation(error.message)
  throw error
}

async function loadControl(db: AnySupabaseClient, tenantId: string, idOrTag: string): Promise<FormControlRow> {
  const byId = /^[0-9a-f-]{36}$/i.test(idOrTag)
  const { data, error } = await (db as any).from('form_controls').select(CONTROL_COLUMNS)
    .eq('tenant_id', tenantId).eq(byId ? 'id' : 'tag', idOrTag).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form control not found')
  return data as FormControlRow
}

async function loadVersions(db: AnySupabaseClient, tenantId: string, controlIds: string[]): Promise<FormControlVersionRow[]> {
  if (!controlIds.length) return []
  const { data, error } = await (db as any).from('form_control_versions').select(VERSION_COLUMNS)
    .eq('tenant_id', tenantId).in('control_id', controlIds)
  if (error) throw dbError(error)
  return (data ?? []) as FormControlVersionRow[]
}

function summarize(row: FormControlRow, versions: FormControlVersionRow[]): FormControlSummary {
  const mine = versions.filter((v) => v.control_id === row.id).sort((a, b) => compareSemver(b.version, a.version))
  const latest = mine.find((v) => v.version === row.latest_version) ?? mine[0] ?? null
  const wanted = latest?.manifest?.network?.allowed_hosts ?? []
  return {
    ...row,
    approved_hosts: row.approved_hosts ?? [],
    manifest: latest?.manifest ?? null,
    versions: mine.map(({ id, version, sha256, size_bytes, source, source_url, signature, created_at }) => ({ id, version, sha256, size_bytes, source, source_url, signature, created_at })),
    pending_hosts: wanted.filter((h) => !(row.approved_hosts ?? []).includes(h)),
  }
}

// ── reads ───────────────────────────────────────────────────────────────────

export async function listFormControls(ctx: ServiceContext, filters: { search?: string; enabled?: boolean } = {}, page: Page = { limit: 200, offset: 0 }) {
  requireAny(ctx, ['extensibility.view', 'forms.view'])
  const db = getDb(ctx)
  let query = (db as any).from('form_controls').select(CONTROL_COLUMNS, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId).order('name', { ascending: true })
  if (filters.enabled !== undefined) query = query.eq('enabled', filters.enabled)
  // Designers without extensibility.view only see what they can place.
  else if (!hasPerm(ctx, 'extensibility.view')) query = query.eq('enabled', true)
  if (filters.search?.trim()) {
    const term = ilikeTerm(filters.search)
    query = query.or(`name.ilike.%${term}%,tag.ilike.%${term}%,description.ilike.%${term}%`)
  }
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  const rows = (data ?? []) as FormControlRow[]
  const versions = await loadVersions(db, ctx.tenantId, rows.map((r) => r.id))
  return { form_controls: rows.map((r) => summarize(r, versions)), total: (count ?? rows.length) as number }
}

export async function getFormControl(ctx: ServiceContext, idOrTag: string): Promise<FormControlSummary> {
  requireAny(ctx, ['extensibility.view', 'forms.view'])
  const db = getDb(ctx)
  const row = await loadControl(db, ctx.tenantId, idOrTag)
  if (!row.enabled && !hasPerm(ctx, 'extensibility.view')) throw ServiceError.notFound('Form control not found')
  return summarize(row, await loadVersions(db, ctx.tenantId, [row.id]))
}

/** One version's manifest (and the module source with `includeBundle`). */
export async function getFormControlVersion(ctx: ServiceContext, idOrTag: string, version: string, options: { includeBundle?: boolean } = {}) {
  requireAny(ctx, ['extensibility.view', 'forms.view'])
  if (options.includeBundle) requireAll(ctx, 'extensibility.view')
  const db = getDb(ctx)
  const row = await loadControl(db, ctx.tenantId, idOrTag)
  const { data, error } = await (db as any).from('form_control_versions')
    .select(options.includeBundle ? `${VERSION_COLUMNS}, bundle` : VERSION_COLUMNS)
    .eq('tenant_id', ctx.tenantId).eq('control_id', row.id).eq('version', version).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound(`Version ${version} of ${row.tag} not found`)
  return { control: row, version: data as FormControlVersionRow & { bundle?: string } }
}

/**
 * The frame route's read: a version's manifest and module for a signed-in
 * member, with the control's enabled / trusted / approved hosts. Service
 * role with an explicit tenant filter (the route has already resolved and
 * checked the workspace). Disabled controls don't load.
 */
export async function loadControlForFrame(ctx: ServiceContext, tag: string, version: string) {
  if (!isValidTag(tag) || !isSemver(version)) throw ServiceError.notFound('Form control not found')
  const db = await serviceRoleClient(ctx)
  const row = await loadControl(db, ctx.tenantId, tag)
  if (!row.enabled) throw ServiceError.forbidden(`The form control "${row.name}" is disabled in this workspace`)
  const { data, error } = await (db as any).from('form_control_versions').select('version, manifest, bundle, sha256')
    .eq('tenant_id', ctx.tenantId).eq('control_id', row.id).eq('version', version).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound(`Version ${version} of ${tag} is not in this workspace's library`)
  // Defence in depth: the stored module must still match its checksum.
  if (sha256Hex(String(data.bundle)) !== data.sha256) throw new ServiceError('internal', 'The stored module does not match its checksum')
  return {
    control: row,
    manifest: parseFormControlManifest(data.manifest),
    bundle: String(data.bundle),
    sha256: String(data.sha256),
    approvedHosts: (row.approved_hosts ?? []).filter((h) => (data.manifest?.network?.allowed_hosts ?? []).includes(h)),
  }
}

// ── usages ──────────────────────────────────────────────────────────────────

async function deletingWorkflowIds(db: AnySupabaseClient, tenantId: string): Promise<Set<string>> {
  const { data, error } = await (db as any).from('deletion_queue').select('target_id')
    .eq('tenant_id', tenantId).eq('target_type', 'workflow').in('status', ['pending', 'processing', 'failed'])
  if (error) return new Set()
  return new Set(((data ?? []) as any[]).map((r) => String(r.target_id)))
}

const OPEN_TASK_STATUSES = ['draft', 'todo', 'in_progress', 'blocked']

/** Every place a tag is used: reusable forms (any stored version), workflow drafts and active published versions, open tasks. */
export async function controlUsages(db: AnySupabaseClient, tenantId: string, tag: string): Promise<FormControlUsage[]> {
  const out: FormControlUsage[] = []
  const { data: forms, error } = await (db as any).from('forms').select('id, name, version, fields').eq('tenant_id', tenantId).limit(5000)
  if (error) throw dbError(error)
  const formNames = new Map<string, string>()
  for (const form of (forms ?? []) as any[]) {
    formNames.set(form.id, form.name)
    for (const ref of customControlRefs(form.fields)) if (ref.tag === tag) out.push({ kind: 'form', id: form.id, name: form.name, where: `version ${form.version}`, field_key: ref.field_key, version: ref.version })
  }
  const { data: formVersions } = await (db as any).from('form_versions').select('form_id, version, fields').eq('tenant_id', tenantId).limit(10000)
  for (const fv of (formVersions ?? []) as any[]) {
    for (const ref of customControlRefs(fv.fields)) {
      if (ref.tag !== tag) continue
      if (out.some((u) => u.kind === 'form' && u.id === fv.form_id && u.version === ref.version && u.field_key === ref.field_key)) continue
      out.push({ kind: 'form', id: fv.form_id, name: formNames.get(fv.form_id) ?? 'Form', where: `version ${fv.version}`, field_key: ref.field_key, version: ref.version })
    }
  }
  const deleting = await deletingWorkflowIds(db, tenantId)
  const { data: workflows, error: wfError } = await (db as any).from('workflows').select('id, name, nodes, user_variables').eq('tenant_id', tenantId).limit(5000)
  if (wfError) throw dbError(wfError)
  const wfNames = new Map<string, string>()
  for (const wf of (workflows ?? []) as any[]) {
    if (deleting.has(String(wf.id))) continue
    wfNames.set(wf.id, wf.name)
    for (const ref of workflowCustomControlRefs((wf.nodes ?? []).filter((n: any) => FORM_NODE_TYPES.has(String(n?.type)) || n?.config?.fields), wf.user_variables)) {
      if (ref.tag === tag) out.push({ kind: 'workflow', id: wf.id, name: `${wf.name} › ${ref.node_label}`, where: 'draft', field_key: ref.field_key, version: ref.version })
    }
  }
  const { data: versions } = await (db as any).from('workflow_versions').select('workflow_id, nodes, user_variables').eq('tenant_id', tenantId).eq('is_active', true).limit(5000)
  for (const v of (versions ?? []) as any[]) {
    if (deleting.has(String(v.workflow_id))) continue
    for (const ref of workflowCustomControlRefs(v.nodes, v.user_variables)) {
      if (ref.tag === tag) out.push({ kind: 'workflow', id: v.workflow_id, name: `${wfNames.get(v.workflow_id) ?? 'Workflow'} › ${ref.node_label}`, where: 'published', field_key: ref.field_key, version: ref.version })
    }
  }
  const { data: tasks } = await (db as any).from('tasks').select('id, title, status, metadata')
    .eq('tenant_id', tenantId).in('status', OPEN_TASK_STATUSES)
    .filter('metadata->fields', 'cs', JSON.stringify([{ type: 'custom', custom: { tag } }])).limit(500)
  for (const task of (tasks ?? []) as any[]) {
    for (const ref of customControlRefs(task.metadata?.fields)) {
      if (ref.tag === tag) out.push({ kind: 'task', id: task.id, name: task.title ?? 'Task', where: task.status, field_key: ref.field_key, version: ref.version })
    }
  }
  return out
}

export async function getFormControlUsages(ctx: ServiceContext, idOrTag: string): Promise<FormControlUsage[]> {
  requireAll(ctx, 'extensibility.view')
  const db = await serviceRoleClient(ctx)
  const row = await loadControl(db, ctx.tenantId, idOrTag)
  return controlUsages(db, ctx.tenantId, row.tag)
}

// ── writes ──────────────────────────────────────────────────────────────────

async function storeParsed(ctx: ServiceContext, parsed: ParsedControlPackage, origin: { source: 'upload' | 'url' | 'import' | 'package'; source_url?: string | null }): Promise<SaveResult> {
  const db = await serviceRoleClient(ctx)
  const { manifest } = parsed
  const { data: existing, error } = await (db as any).from('form_controls').select(CONTROL_COLUMNS)
    .eq('tenant_id', ctx.tenantId).eq('tag', manifest.tag).maybeSingle()
  if (error) throw dbError(error)
  let control = existing as FormControlRow | null
  let outcome: SaveResult['outcome'] = 'version'
  if (!control) {
    requireAll(ctx, 'extensibility.create')
    const { data, error: insertError } = await (db as any).from('form_controls').insert({
      tenant_id: ctx.tenantId, tag: manifest.tag, name: manifest.name, description: manifest.description ?? null, icon: manifest.icon ?? null,
      latest_version: manifest.version, enabled: true, trusted: false, approved_hosts: [], created_by: ctx.actorId, updated_by: ctx.actorId,
    }).select(CONTROL_COLUMNS).single()
    if (insertError || !data) throw insertError?.code === '23505' ? ServiceError.conflict(`A form control with tag "${manifest.tag}" already exists`) : dbError(insertError, 'Failed to create the form control')
    control = data as FormControlRow
    outcome = 'created'
  } else {
    requireAll(ctx, 'extensibility.edit')
    const { data: same } = await (db as any).from('form_control_versions').select('sha256')
      .eq('tenant_id', ctx.tenantId).eq('control_id', control.id).eq('version', manifest.version).maybeSingle()
    if (same) {
      if (same.sha256 === parsed.sha256) {
        return { control: summarize(control, await loadVersions(db, ctx.tenantId, [control.id])), version: manifest.version, outcome: 'unchanged', warnings: parsed.warnings }
      }
      throw ServiceError.conflict(`Version ${manifest.version} of ${manifest.tag} already exists with different content — versions are immutable; bump the version in manifest.json`)
    }
  }
  const { error: versionError } = await (db as any).from('form_control_versions').insert({
    tenant_id: ctx.tenantId, control_id: control.id, version: manifest.version, manifest, bundle: parsed.bundle,
    sha256: parsed.sha256, size_bytes: parsed.size_bytes, source: origin.source, source_url: origin.source_url ?? null,
    signature: parsed.signature, created_by: ctx.actorId,
  })
  if (versionError) {
    if (outcome === 'created') await (db as any).from('form_controls').delete().eq('id', control.id).eq('tenant_id', ctx.tenantId)
    throw versionError.code === '23505' ? ServiceError.conflict(`Version ${manifest.version} already exists`) : dbError(versionError, 'Failed to store the version')
  }
  // The newest version becomes the default for new placements (and its name / icon the library's).
  const newest = compareSemver(manifest.version, control.latest_version) >= 0 || outcome === 'created'
  if (newest) {
    const { data: updated, error: updateError } = await (db as any).from('form_controls').update({
      latest_version: manifest.version, name: manifest.name, description: manifest.description ?? null, icon: manifest.icon ?? null, updated_by: ctx.actorId,
    }).eq('id', control.id).eq('tenant_id', ctx.tenantId).select(CONTROL_COLUMNS).single()
    if (updateError) throw dbError(updateError)
    control = updated as FormControlRow
  }
  await audit(ctx, {
    objectType: 'form_control', objectId: control.id, action: outcome === 'created' ? 'create' : 'update',
    summary: `${outcome === 'created' ? 'Added form control' : 'Added version'} ${manifest.tag}@${manifest.version} (${origin.source})`,
    metadata: { version: manifest.version, sha256: parsed.sha256, source: origin.source, ...(origin.source_url ? { source_url: origin.source_url } : {}), signature_verified: parsed.signature?.verified ?? null },
  })
  return { control: summarize(control, await loadVersions(db, ctx.tenantId, [control.id])), version: manifest.version, outcome, warnings: parsed.warnings }
}

/** Upload a package (zip, or module + manifest): a new control, or a new version of the control with the same tag. */
export async function uploadFormControl(ctx: ServiceContext, input: UploadInput, origin: { source?: 'upload' | 'package' } = {}): Promise<SaveResult> {
  requireAny(ctx, ['extensibility.create', 'extensibility.edit'])
  let parsed: ParsedControlPackage
  try {
    parsed = await parseControlUpload(input)
  } catch (error) {
    packageError(error)
  }
  return storeParsed(ctx, parsed, { source: origin.source ?? 'upload' })
}

async function fetchLimited(url: string, maxBytes: number): Promise<Uint8Array> {
  const { safeFetch, EgressBlockedError } = await import('@/lib/egress-guard')
  let res: Response
  try {
    res = await safeFetch(url, { headers: { Accept: '*/*' }, signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    if (error instanceof EgressBlockedError) throw ServiceError.validation(`That URL is not allowed: ${error.message}`)
    throw ServiceError.validation(`Could not fetch ${url}: ${error instanceof Error ? error.message : 'network error'}`)
  }
  if (!res.ok) throw ServiceError.validation(`Fetching ${url} returned HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw ServiceError.validation(`${url} is larger than ${Math.round(maxBytes / 1024)} KB`)
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array(await res.arrayBuffer())
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw ServiceError.validation(`${url} is larger than ${Math.round(maxBytes / 1024)} KB`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

function httpsUrl(raw: string, label: string): string {
  let url: URL
  try { url = new URL(String(raw ?? '').trim()) } catch { throw ServiceError.validation(`${label} is not a URL`) }
  if (url.protocol !== 'https:') throw ServiceError.validation(`${label} must be an https:// URL`)
  return url.toString()
}

/**
 * Import from a URL: a zip package, or an ES module with its manifest
 * (`manifest_url`, default manifest.json next to the module). Fetched once
 * through the egress guard and snapshotted — the form never loads the URL.
 */
export async function importFormControlFromUrl(ctx: ServiceContext, input: { url: string; manifest_url?: string | null }): Promise<SaveResult> {
  requireAny(ctx, ['extensibility.create', 'extensibility.edit'])
  const url = httpsUrl(input.url, 'url')
  const bytes = await fetchLimited(url, PACKAGE_LIMITS.zipBytes)
  let parsed: ParsedControlPackage
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      parsed = await parseZipPackage(bytes)
    } else {
      const manifestUrl = httpsUrl(input.manifest_url || new URL('manifest.json', url).toString(), 'manifest_url')
      const manifestBytes = await fetchLimited(manifestUrl, PACKAGE_LIMITS.manifestBytes)
      parsed = parseModulePackage(new TextDecoder().decode(bytes), new TextDecoder().decode(manifestBytes))
    }
  } catch (error) {
    packageError(error)
  }
  return storeParsed(ctx, parsed, { source: 'url', source_url: url })
}

export interface FormControlUpdate {
  enabled?: boolean
  name?: string
  description?: string | null
  /** Network hosts approved for the control (only hosts its manifest asks for). */
  approved_hosts?: string[]
  /** Instance admins only (inline rendering without the sandbox). */
  trusted?: boolean
}

export async function updateFormControl(ctx: ServiceContext, idOrTag: string, input: FormControlUpdate, options: { instanceAdmin?: boolean } = {}): Promise<FormControlSummary> {
  requireAll(ctx, 'extensibility.edit')
  const db = await serviceRoleClient(ctx)
  const row = await loadControl(db, ctx.tenantId, idOrTag)
  const versions = await loadVersions(db, ctx.tenantId, [row.id])
  const patch: Record<string, unknown> = { updated_by: ctx.actorId }
  if (input.enabled !== undefined) patch.enabled = input.enabled === true
  if (input.name !== undefined) {
    const name = String(input.name ?? '').trim()
    if (!name || name.length > 120) throw ServiceError.validation('name must be between 1 and 120 characters')
    patch.name = name
  }
  if (input.description !== undefined) patch.description = String(input.description ?? '').trim().slice(0, 2000) || null
  if (input.approved_hosts !== undefined) {
    const wanted = new Set(versions.flatMap((v) => v.manifest?.network?.allowed_hosts ?? []))
    const hosts = normalizeHosts(input.approved_hosts)
    const unknown = hosts.filter((h) => !wanted.has(h))
    if (unknown.length) throw ServiceError.validation(`Only hosts a version's manifest asks for can be approved (not ${unknown.join(', ')})`)
    patch.approved_hosts = hosts
  }
  if (input.trusted !== undefined) {
    if (!options.instanceAdmin) throw ServiceError.forbidden('Only an instance administrator can mark a form control as trusted')
    patch.trusted = input.trusted === true
  }
  const { data, error } = await (db as any).from('form_controls').update(patch).eq('id', row.id).eq('tenant_id', ctx.tenantId).select(CONTROL_COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to update the form control')
  const changed = Object.keys(patch).filter((k) => k !== 'updated_by')
  await audit(ctx, {
    objectType: 'form_control', objectId: row.id, action: 'update',
    summary: input.trusted !== undefined ? `${input.trusted ? 'Trusted' : 'Untrusted'} form control ${row.tag}` : input.enabled !== undefined ? `${input.enabled ? 'Enabled' : 'Disabled'} form control ${row.tag}` : `Updated form control ${row.tag}`,
    metadata: { fields: changed, ...(input.approved_hosts ? { approved_hosts: patch.approved_hosts } : {}) },
  })
  return summarize(data as FormControlRow, versions)
}

/** Delete a control (all versions), or one version — refused while anything uses it. */
export async function deleteFormControl(ctx: ServiceContext, idOrTag: string, options: { version?: string | null } = {}) {
  requireAll(ctx, 'extensibility.delete')
  const db = await serviceRoleClient(ctx)
  const row = await loadControl(db, ctx.tenantId, idOrTag)
  const usages = (await controlUsages(db, ctx.tenantId, row.tag)).filter((u) => !options.version || u.version === options.version)
  if (usages.length) {
    const list = usages.slice(0, 10).map((u) => `${u.kind} "${u.name}" (${u.field_key}${u.version ? `, ${u.version}` : ''})`).join('; ')
    throw new ServiceError('conflict', `${row.tag}${options.version ? `@${options.version}` : ''} is in use: ${list}${usages.length > 10 ? ` and ${usages.length - 10} more` : ''}. Remove it from those forms first.`, { details: { usages } })
  }
  if (options.version) {
    const versions = await loadVersions(db, ctx.tenantId, [row.id])
    if (!versions.some((v) => v.version === options.version)) throw ServiceError.notFound(`Version ${options.version} not found`)
    if (versions.length === 1) throw ServiceError.validation('That is the only version — delete the control instead')
    const { error } = await (db as any).from('form_control_versions').delete().eq('tenant_id', ctx.tenantId).eq('control_id', row.id).eq('version', options.version)
    if (error) throw dbError(error)
    const remaining = versions.map((v) => v.version).filter((v) => v !== options.version)
    if (row.latest_version === options.version) {
      await (db as any).from('form_controls').update({ latest_version: latestVersion(remaining), updated_by: ctx.actorId }).eq('id', row.id).eq('tenant_id', ctx.tenantId)
    }
    await audit(ctx, { objectType: 'form_control', objectId: row.id, action: 'delete', summary: `Deleted version ${row.tag}@${options.version}`, metadata: { version: options.version } })
    return { deleted: true as const, id: row.id, version: options.version }
  }
  const { error } = await (db as any).from('form_controls').delete().eq('id', row.id).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, { objectType: 'form_control', objectId: row.id, action: 'delete', summary: `Deleted form control ${row.tag}` })
  return { deleted: true as const, id: row.id }
}

// ── portable export / import (config as code, packages) ────────────────────

export interface PortableFormControl {
  tag: string
  name: string
  description: string | null
  icon: string | null
  enabled: boolean
  versions: Array<{ version: string; manifest: FormControlManifest; bundle: string; sha256: string; signature: ControlSignature | null }>
}

export interface PortableFormControlPayload {
  version: 1
  asset_type: 'form_control'
  form_control: PortableFormControl
}

/** Portable JSON: the control and every version (module included). Approved hosts and the trusted flag are workspace decisions and are not exported. */
export async function exportFormControl(ctx: ServiceContext, idOrTag: string): Promise<PortableFormControlPayload> {
  requireAll(ctx, 'extensibility.view')
  const db = await serviceRoleClient(ctx)
  const row = await loadControl(db, ctx.tenantId, idOrTag)
  const { data, error } = await (db as any).from('form_control_versions').select('version, manifest, bundle, sha256, signature')
    .eq('tenant_id', ctx.tenantId).eq('control_id', row.id)
  if (error) throw dbError(error)
  const versions = ((data ?? []) as any[]).sort((a, b) => compareSemver(a.version, b.version))
    .map((v) => ({ version: String(v.version), manifest: v.manifest, bundle: String(v.bundle), sha256: String(v.sha256), signature: v.signature ?? null }))
  return { version: 1, asset_type: 'form_control', form_control: { tag: row.tag, name: row.name, description: row.description, icon: row.icon, enabled: row.enabled, versions } }
}

/**
 * Import a portable export (or the bare form_control object): creates the
 * control when the tag is new and adds every version it doesn't have. A
 * version whose module doesn't match its recorded SHA-256 is refused; one
 * that exists with different content is refused (immutable versions).
 */
export async function importFormControl(ctx: ServiceContext, source: unknown, options: { source?: 'import' | 'package' } = {}): Promise<SaveResult & { added: string[]; skipped: string[] }> {
  requireAny(ctx, ['extensibility.create', 'extensibility.edit'])
  let payload: any = source
  if (typeof source === 'string') {
    try { payload = JSON.parse(source) } catch { throw ServiceError.validation('Import JSON is not valid') }
  }
  const asset = payload?.form_control ?? payload
  if (!asset || typeof asset !== 'object' || !Array.isArray(asset.versions) || asset.versions.length === 0) throw ServiceError.validation('Expected { form_control: { tag, versions: [...] } }')
  if (asset.versions.length > 50) throw ServiceError.validation('At most 50 versions per import')
  const added: string[] = []
  const skipped: string[] = []
  let last: SaveResult | null = null
  const ordered = [...asset.versions].sort((a: any, b: any) => compareSemver(String(a?.version ?? '0.0.0'), String(b?.version ?? '0.0.0')))
  for (const v of ordered) {
    let parsed: ParsedControlPackage
    try {
      parsed = parseModulePackage(String(v?.bundle ?? ''), v?.manifest)
    } catch (error) {
      packageError(error)
    }
    if (v?.sha256 && v.sha256 !== parsed.sha256) throw ServiceError.validation(`Version ${parsed.manifest.version}: the module does not match its recorded SHA-256`)
    if (asset.tag && parsed.manifest.tag !== asset.tag) throw ServiceError.validation(`Version ${parsed.manifest.version} is for "${parsed.manifest.tag}", not "${asset.tag}"`)
    if (v?.signature && typeof v.signature === 'object') parsed = { ...parsed, signature: { alg: 'ed25519', key_fingerprint: String(v.signature.key_fingerprint ?? ''), verified: false } }
    const result = await storeParsed(ctx, parsed, { source: options.source ?? 'import' })
    ;(result.outcome === 'unchanged' ? skipped : added).push(parsed.manifest.version)
    last = result
  }
  if (asset.enabled === false && last && last.outcome === 'created') {
    last = { ...last, control: await updateFormControl(ctx, last.control.id, { enabled: false }) }
  }
  return { ...(last as SaveResult), added, skipped }
}

/**
 * After a package install: versions that arrived without a signature of their
 * own record the PACKAGE's verified signature (signer fingerprint, `via:
 * 'package'`), so Extensibility → Form controls shows that an official
 * gallery control is signed by the UserTasks Gallery key. Only versions whose
 * module still matches the package's checksum are marked.
 */
export async function recordPackageSignatures(
  db: AnySupabaseClient,
  tenantId: string,
  controls: unknown[] | undefined,
  verification: { signed?: boolean; signature_ok?: boolean | null; fingerprint?: string | null },
): Promise<number> {
  if (!verification.signed || verification.signature_ok !== true || !verification.fingerprint || !Array.isArray(controls) || !controls.length) return 0
  let marked = 0
  for (const control of controls as any[]) {
    const tag = typeof control?.tag === 'string' ? control.tag : ''
    if (!isValidTag(tag) || !Array.isArray(control.versions)) continue
    const { data: row } = await (db as any).from('form_controls').select('id').eq('tenant_id', tenantId).eq('tag', tag).maybeSingle()
    if (!row) continue
    for (const v of control.versions) {
      const bundle = typeof v?.bundle === 'string' ? v.bundle : ''
      if (!bundle || !isSemver(v?.version)) continue
      const signature: ControlSignature = { alg: 'ed25519', key_fingerprint: String(verification.fingerprint), verified: true, via: 'package' }
      const { data, error } = await (db as any).from('form_control_versions').update({ signature })
        .eq('tenant_id', tenantId).eq('control_id', row.id).eq('version', v.version).eq('sha256', sha256Hex(bundle)).is('signature', null)
        .select('id')
      if (!error) marked += (data ?? []).length
    }
  }
  return marked
}

/** Upload helper for adapters that receive base64 (API / MCP). */
export function decodeBase64Package(base64: string): Uint8Array {
  const clean = String(base64 ?? '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw ServiceError.validation('package_base64 is not valid base64')
  return new Uint8Array(Buffer.from(clean, 'base64'))
}
