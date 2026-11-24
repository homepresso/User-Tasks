/**
 * Importers: files from other products (workflow exports, form templates)
 * → UserTasks workflows and forms. Shared by GET/POST /api/v1/importers…,
 * the MCP importers_* tools and the Import dialogs of Automations and Forms.
 *
 *   list      every importer of this build with its availability here
 *   detect    which importer reads these files best (detect hooks)
 *   analyze   dry run: the importer's report (mapping coverage, complexity,
 *             readiness, what would be made) — nothing is stored
 *   import    the importer creates drafts (workflows inactive) through the
 *             extension host (as the caller); audited here
 *
 * Extension importers are gated like every extension surface: enabled in
 * the workspace and licensed with the importer's feature (402 when not —
 * importers lock when a licence lapses, workflows already made keep
 * running). Permissions: listing needs workflows.view or forms.view; a dry
 * run the view permission of what it makes; an import the importer's
 * permission (default workflows.create / forms.edit). Files are never stored.
 */

import { isExtensionError, type ImportFile, type ImportReport, type ImportResult } from '@/lib/extensions/sdk'
import type { ImporterContribution } from '@/lib/extensions/manifest'
import { importComplexityLevel, importCoverage, importReadiness, importReportMarkdown } from '@/lib/importers/report'
import { acceptsFile, getImporter, listImporters, type RegisteredImporter } from '@/lib/importers/registry'
import { hasPerm, requireAny, ServiceError, type ServiceContext } from './context'
import { audit } from './_shared'

const MB = 1024 * 1024
export const IMPORT_LIMITS = {
  maxFiles: 50,
  /** Total upload (IMPORT_MAX_MB, default 20 MB, at most 100). */
  get maxTotalBytes() {
    const mb = Number(process.env.IMPORT_MAX_MB)
    return (Number.isFinite(mb) && mb > 0 ? Math.min(mb, 100) : 20) * MB
  },
}

export interface ImporterView {
  id: string
  extension_id: string | null
  extension_name: string | null
  label: string
  description: string | null
  produces: Array<'workflow' | 'form'>
  accepts: string[]
  multiple: boolean
  /** Files are optional: the importer can read its source from its options (a connected system). */
  files_optional: boolean
  preview: boolean
  feature: string | null
  options: ImporterContribution['options']
  /** The importer is enabled and licensed here and the caller may use it. */
  available: boolean
  unavailable_reason: string | null
  /** Served by its own endpoint (the core InfoPath importer: /forms/import/infopath). */
  endpoint: string | null
}

export interface ImportAnalysis {
  importer: string
  report: ImportReport
  markdown: string
}

export interface ImportOutcome extends ImportAnalysis {
  created: ImportResult['created']
  warnings: string[]
}

/** The core Nintex importer makes workflows (and forms when the files carry Nintex Forms: createForm checks forms.edit itself). */
function workflowFirst(c: Pick<ImporterContribution, 'key'>, id?: string): boolean {
  return id === 'nintex' || c.key === 'nintex'
}

function viewPermissions(c: Pick<ImporterContribution, 'produces'>): string[] {
  return [...(c.produces.includes('workflow') ? ['workflows.view'] : []), ...(c.produces.includes('form') ? ['forms.view'] : [])]
}

function importPermissions(c: Pick<ImporterContribution, 'produces' | 'permission'> & { key?: string }): string[][] {
  if (c.permission) return [[c.permission]]
  if (c.key && workflowFirst({ key: c.key })) return [['workflows.create', 'workflows.edit']]
  // Each kind made needs its own create permission (workflows: create or edit).
  return [...(c.produces.includes('workflow') ? [['workflows.create', 'workflows.edit']] : []), ...(c.produces.includes('form') ? [['forms.edit']] : [])]
}

function mayImport(ctx: ServiceContext, c: Pick<ImporterContribution, 'produces' | 'permission'>): boolean {
  return importPermissions(c).every((any) => any.some((p) => hasPerm(ctx, p)))
}

async function access(ctx: ServiceContext, importer: RegisteredImporter) {
  if (!importer.extensionId) return { usable: true, reason: null as string | null, error: null as ServiceError | null }
  const { extensionAccess, extensionAccessError } = await import('@/lib/extensions/state')
  const result = await extensionAccess(ctx.tenantId, importer.extensionId, importer.contribution.feature)
  return { usable: result.usable, reason: result.reason, error: result.usable ? null : extensionAccessError(result, importer.extensionId, importer.contribution.feature) }
}

export async function listImporterViews(ctx: ServiceContext, filter: { produces?: 'workflow' | 'form' } = {}): Promise<{ importers: ImporterView[]; total: number }> {
  requireAny(ctx, ['workflows.view', 'forms.view'])
  const all = (await listImporters()).filter((i) => !filter.produces || i.contribution.produces.includes(filter.produces))
  const importers: ImporterView[] = []
  for (const i of all) {
    const c = i.contribution
    const a = await access(ctx, i)
    const permitted = mayImport(ctx, c)
    importers.push({
      id: i.id, extension_id: i.extensionId, extension_name: i.extensionName, label: c.label, description: c.description ?? null,
      produces: c.produces, accepts: c.accepts, multiple: c.multiple, files_optional: c.filesOptional, preview: c.preview, feature: c.feature ?? null, options: c.options,
      available: a.usable && permitted,
      unavailable_reason: !a.usable ? a.reason : permitted ? null : `Needs ${importPermissions(c).map((any) => any.join(' or ')).join(' and ')}`,
      endpoint: i.endpoint,
    })
  }
  return { importers, total: importers.length }
}

/** Decoded upload → ImportFile[], bounded. */
export function checkFiles(contribution: ImporterContribution, files: ImportFile[]): ImportFile[] {
  const list = Array.isArray(files) ? files : []
  if (list.length > IMPORT_LIMITS.maxFiles) throw ServiceError.validation(`At most ${IMPORT_LIMITS.maxFiles} files per import`)
  let total = 0
  const out: ImportFile[] = []
  for (const f of list) {
    const name = String(f?.name ?? '').replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, 200)
    if (!name) throw ServiceError.validation('Every file needs a name')
    if (!(f.bytes instanceof Uint8Array)) throw ServiceError.validation(`${name}: no content`)
    total += f.bytes.length
    if (total > IMPORT_LIMITS.maxTotalBytes) throw ServiceError.validation(`The files are larger than ${Math.round(IMPORT_LIMITS.maxTotalBytes / MB)} MB together`)
    if (!acceptsFile(contribution, name)) throw ServiceError.validation(`${name}: this importer reads ${contribution.accepts.length ? contribution.accepts.join(', ') : 'no files (it reads its source from the options)'}`)
    out.push({ name, bytes: f.bytes, contentType: f.contentType ? String(f.contentType).slice(0, 120) : null })
  }
  if (!contribution.multiple && out.length > 1) throw ServiceError.validation('This importer reads one file at a time')
  return out
}

function cleanOptions(contribution: ImporterContribution, raw: unknown): Record<string, unknown> {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw ServiceError.validation('options must be an object')
  const allowed = new Set(contribution.options.map((o) => o.name))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(k)) continue
    if (typeof v === 'string') out[k] = v.slice(0, 10_000)
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
    else if (Array.isArray(v)) out[k] = v.slice(0, 200).map((x) => (typeof x === 'string' ? x.slice(0, 2000) : x))
    else if (typeof v === 'object') out[k] = v
  }
  for (const o of contribution.options) if (o.required && (out[o.name] === undefined || out[o.name] === '')) throw ServiceError.validation(`${o.label ?? o.name} is required`)
  return out
}

const STATUSES = new Set(['mapped', 'partial', 'placeholder', 'skipped', 'info'])

/** An extension's report, bounded and with coverage / level / readiness recomputed from its items. */
export function normalizeReport(raw: unknown, fallback: { title: string; source: string; preview: boolean }): ImportReport {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ImportReport>
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 2000).map((i) => ({
    kind: String(i?.kind ?? 'item').slice(0, 60),
    name: String(i?.name ?? '').slice(0, 300),
    status: (STATUSES.has(String(i?.status)) ? i.status : 'info') as ImportReport['items'][number]['status'],
    ...(i?.mappedTo ? { mappedTo: String(i.mappedTo).slice(0, 300) } : {}),
    ...(i?.detail ? { detail: String(i.detail).slice(0, 2000) } : {}),
    ...(i?.location ? { location: String(i.location).slice(0, 300) } : {}),
    ...(i?.origin === 'ai' ? { origin: 'ai' as const } : {}),
  }))
  const coverage = importCoverage(items)
  const score = Math.max(0, Math.min(100, Math.round(Number(r.complexity?.score) || 0)))
  return {
    title: String(r.title ?? fallback.title).slice(0, 200) || fallback.title,
    source: String(r.source ?? fallback.source).slice(0, 120),
    summary: r.summary ? String(r.summary).slice(0, 4000) : null,
    coverage,
    complexity: { score, level: importComplexityLevel(score), factors: (Array.isArray(r.complexity?.factors) ? r.complexity.factors : []).slice(0, 30).map((f) => String(f).slice(0, 300)) },
    readiness: importReadiness(coverage, score),
    items,
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).slice(0, 200).map((w) => String(w).slice(0, 1000)),
    preview: fallback.preview || r.preview === true,
    outputs: (Array.isArray(r.outputs) ? r.outputs : []).slice(0, 100).map((o) => ({ kind: (['workflow', 'form'].includes(String(o?.kind)) ? o.kind : 'other') as 'workflow' | 'form' | 'other', name: String(o?.name ?? '').slice(0, 200), ...(o?.detail ? { detail: String(o.detail).slice(0, 500) } : {}) })),
    ...(r.details && typeof r.details === 'object' ? { details: r.details } : {}),
  }
}

async function resolve(ctx: ServiceContext, id: string, files: ImportFile[]): Promise<RegisteredImporter> {
  if (id === 'auto') {
    const best = await detectImporter(ctx, files)
    if (!best) throw ServiceError.validation('No importer recognises these files')
    id = best.id
  }
  const importer = await getImporter(id)
  if (!importer) throw ServiceError.notFound(`Unknown importer "${id}"`)
  if (importer.core) return importer
  if (!importer.handler) throw ServiceError.validation(`The ${importer.contribution.label} importer has its own endpoint: ${importer.endpoint}`)
  const a = await access(ctx, importer)
  if (a.error) throw a.error
  return importer
}

async function handlerContext(ctx: ServiceContext, importer: RegisteredImporter) {
  // Extension importers may run the core InfoPath importer (ctx.importers.infopath): load it so it registers.
  await import('./infopath-import')
  const { createExtensionContext } = await import('@/lib/extensions/host')
  return createExtensionContext({
    extensionId: importer.extensionId!, tenantId: ctx.tenantId, actorId: ctx.actorId ?? ctx.credentialOwnerId ?? null, db: ctx.supabase, permissions: ctx.permissions,
  })
}

function rethrow(error: unknown, label: string): never {
  if (isExtensionError(error)) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 500
    const code = status === 404 ? 'not_found' : status === 409 || status === 412 ? 'conflict' : status === 403 ? 'forbidden' : status === 402 ? 'payment_required' : status >= 500 ? 'internal' : 'validation_error'
    throw new ServiceError(code, error.message, { status, details: { code: error.code, ...(error.details ?? {}) } })
  }
  if (error instanceof ServiceError) throw error
  console.error(`[importers] ${label} failed:`, error instanceof Error ? error.message : error)
  throw new ServiceError('internal', `The ${label} importer failed — the files may be damaged or of an unexpected version`)
}

/** The extension importer that reads these files best (detect > 0), among those usable here. */
export async function detectImporter(ctx: ServiceContext, files: ImportFile[]): Promise<{ id: string; score: number } | null> {
  let best: { id: string; score: number } | null = null
  for (const importer of await listImporters()) {
    const detect = importer.core?.detect ? (input: { files: ImportFile[] }) => importer.core!.detect!(input.files) : importer.handler?.detect?.bind(importer.handler)
    if (!detect || !files.every((f) => acceptsFile(importer.contribution, f.name))) continue
    if (!(await access(ctx, importer)).usable) continue
    let score = 0
    try { score = Number(detect({ files })) || 0 } catch { score = 0 }
    if (score > 0 && (!best || score > best.score)) best = { id: importer.id, score: Math.min(1, score) }
  }
  return best
}

export async function analyzeImport(ctx: ServiceContext, id: string, rawFiles: ImportFile[], rawOptions?: unknown): Promise<ImportAnalysis> {
  const importer = await resolve(ctx, id, rawFiles)
  const c = importer.contribution
  requireAny(ctx, viewPermissions(c))
  const files = checkFiles(c, rawFiles)
  if (c.accepts.length && !c.filesOptional && !files.length) throw ServiceError.validation('No file was sent')
  const options = cleanOptions(c, rawOptions)
  let raw: ImportReport
  try {
    raw = importer.core ? await importer.core.analyze(ctx, files, options) : await importer.handler!.analyze({ ctx: await handlerContext(ctx, importer), files, options })
  } catch (error) {
    rethrow(error, c.label)
  }
  const report = normalizeReport(raw, { title: files[0]?.name ?? c.label, source: c.label, preview: c.preview })
  return { importer: importer.id, report, markdown: importReportMarkdown(report) }
}

export async function runImport(ctx: ServiceContext, id: string, rawFiles: ImportFile[], rawOptions?: unknown): Promise<ImportOutcome> {
  const importer = await resolve(ctx, id, rawFiles)
  const c = importer.contribution
  if (!(await nintexIntoDesignable(ctx, importer, rawOptions))) for (const any of importPermissions(c)) requireAny(ctx, any)
  const files = checkFiles(c, rawFiles)
  if (c.accepts.length && !c.filesOptional && !files.length) throw ServiceError.validation('No file was sent')
  const options = cleanOptions(c, rawOptions)
  let result: ImportResult
  try {
    result = importer.core ? await importer.core.import(ctx, files, options) : await importer.handler!.import({ ctx: await handlerContext(ctx, importer), files, options })
  } catch (error) {
    rethrow(error, c.label)
  }
  const report = normalizeReport(result?.report, { title: files[0]?.name ?? c.label, source: c.label, preview: c.preview })
  const created = (Array.isArray(result?.created) ? result.created : []).slice(0, 200).map((x) => ({
    kind: (['workflow', 'form'].includes(String(x?.kind)) ? x.kind : 'other') as 'workflow' | 'form' | 'other',
    id: String(x?.id ?? ''), name: String(x?.name ?? '').slice(0, 200),
    href: x?.href && /^\/(?!\/)/.test(String(x.href)) ? String(x.href) : x?.kind === 'workflow' ? `/automations/${x.id}` : x?.kind === 'form' ? `/automations/forms/${x.id}` : null,
  }))
  const warnings = (Array.isArray(result?.warnings) ? result.warnings : []).slice(0, 100).map((w) => String(w).slice(0, 1000))
  const first = created.find((x) => x.kind === 'workflow' || x.kind === 'form')
  await audit(ctx, {
    objectType: first?.kind === 'form' ? 'form' : 'workflow',
    objectId: first?.id ?? importer.id,
    action: 'import',
    summary: `Imported "${report.title}" with ${c.label}: ${created.length} created (coverage ${report.coverage.percent}%)`,
    metadata: { importer: importer.id, files: files.map((f) => f.name), created: created.map((x) => ({ kind: x.kind, id: x.id })), coverage: report.coverage.percent, complexity: report.complexity.score },
  }).catch(() => undefined)
  return { importer: importer.id, report, markdown: importReportMarkdown(report), created, warnings }
}

/**
 * A Nintex import into ONE existing workflow the person may design (workflows.edit, or an Edit
 * grant — e.g. a SharePoint list manager in the embedded designer) without forms: allowed without
 * workflows.create. updateWorkflow checks the design access again.
 */
async function nintexIntoDesignable(ctx: ServiceContext, importer: RegisteredImporter, rawOptions: unknown): Promise<boolean> {
  if (importer.id !== 'nintex' || !rawOptions || typeof rawOptions !== 'object') return false
  const o = rawOptions as Record<string, unknown>
  const workflowId = typeof o.workflow_id === 'string' ? o.workflow_id : ''
  if (!/^[0-9a-f-]{36}$/i.test(workflowId) || o.forms !== 'skip') return false
  if (o.target !== 'replace' && !(typeof o.target === 'string' && o.target.startsWith('ext.'))) return false
  try {
    const { requireDesignAccess } = await import('./design-access')
    await requireDesignAccess(ctx, 'workflow', workflowId)
    return true
  } catch {
    return false
  }
}

/** base64 files of a JSON body (REST / MCP) → ImportFile[]. */
export function decodeImportFiles(files: Array<{ name: string; content_base64: string; content_type?: string | null }> | undefined): ImportFile[] {
  const list = Array.isArray(files) ? files : []
  if (list.length > IMPORT_LIMITS.maxFiles) throw ServiceError.validation(`At most ${IMPORT_LIMITS.maxFiles} files per import`)
  let total = 0
  return list.map((f) => {
    const clean = String(f?.content_base64 ?? '').replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '')
    if (clean && !/^[A-Za-z0-9+/]+=*$/.test(clean)) throw ServiceError.validation(`${f?.name ?? 'file'}: content_base64 is not base64`)
    total += Math.floor(clean.length * 3 / 4)
    if (total > IMPORT_LIMITS.maxTotalBytes + 3) throw ServiceError.validation(`The files are larger than ${Math.round(IMPORT_LIMITS.maxTotalBytes / MB)} MB together`)
    return { name: String(f?.name ?? ''), bytes: new Uint8Array(Buffer.from(clean, 'base64')), contentType: f?.content_type ?? null }
  })
}
