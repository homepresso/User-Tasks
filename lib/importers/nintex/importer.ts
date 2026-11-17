/**
 * The core Nintex importer: Nintex for SharePoint workflow exports (.nwf),
 * Nintex for Office 365 packages (.nwp, with their Nintex Forms) and zips of
 * them → UserTasks workflows (drafts) and forms. Available to everyone (no
 * licence feature); files are never stored.
 *
 * Where it goes (option `target`):
 *   new                  a new standalone workflow: started by API / manually
 *                        (webhook trigger), or on a schedule (`trigger:
 *                        schedule`, the default for Nintex site workflows);
 *                        SharePoint list actions become marked placeholders
 *   replace              a new DRAFT of an existing workflow (`workflow_id`):
 *                        same id, name, versions and run history; its trigger
 *                        is kept; the person reviews, then publishes. Needs
 *                        `confirm: true` (analyse first: the report says what
 *                        is replaced)
 *   ext.<id>.<key>       an extension's target (e.g. a connected SharePoint
 *                        list + events, ServerExtension.nintex): the trigger,
 *                        a first step and list-action mapping come from its
 *                        plan; with `workflow_id` it replaces that workflow
 *                        (its trigger becomes the target's); with
 *                        `keep_trigger` the replaced workflow keeps its own
 *                        trigger (the designer's "Connect to this list":
 *                        the workflow already is bound to that list and
 *                        event). A target that already has a workflow on
 *                        its events (plan.into: one workflow per event)
 *                        gets the import as a new draft of THAT workflow,
 *                        never a second one
 * Column check (targets with NintexImportHook.columns): the columns the
 * Nintex workflow uses against the list's real ones (./columns.ts) —
 * matched / type mismatch / missing in report.details.columns; references
 * matched by display name move to the list's internal name; steps that use
 * a missing column are flagged in the designer (config._import_review).
 * Start-form variables become start parameters (label, required, choices).
 * Forms (option `forms`): new standalone forms (default), skip, or replace
 * one existing form's draft (`form_id`, one form in the upload).
 */
import type { ImportFile, ImportReport, ImportReportItem, NintexImportHook, NintexStartOptions, NintexTargetPlan } from '@/lib/extensions/sdk'
import type { ImporterContribution } from '@/lib/extensions/manifest'
import { importComplexityLevel, importCoverage, importReadiness } from '@/lib/importers/report'
import { ServiceError, type ServiceContext } from '@/lib/services/context'
import { parseNintexForm, type NintexFormModel } from './forms'
import { mapNintex, type MappedNintex, type NintexMapEnv } from './map'
import { NintexFormatError, type NintexWorkflow } from './model'
import { parseNwf } from './read-nwf'
import { parseNwpBytes, parseNwpEntries } from './read-nwp'
import { decodeText } from './xml'
import { assignmentConfig, normalizeRef, resolveAssignees, type AssigneeResolution } from './assignees'
import { checkColumns, collectColumnRefs, columnsNeeded, flagMissingColumns, startParameters, usesDocuments, type ColumnCheck } from './columns'

export const NINTEX_IMPORTER_ID = 'nintex'

export const CORE_NINTEX_IMPORTER: ImporterContribution = {
  key: 'nintex',
  label: 'Nintex workflow (.nwf / .nwp)',
  description: 'Nintex for SharePoint workflow exports (.nwf) and Nintex for Office 365 packages (.nwp, with their Nintex Forms): a new workflow, a SharePoint list workflow (with the SharePoint extension), or a new draft of an existing workflow.',
  produces: ['workflow', 'form'],
  accepts: ['.nwf', '.nwp', '.zip', '.xml'],
  multiple: true,
  filesOptional: false,
  preview: false,
  options: [
    { name: 'target', label: 'Where should this go?', type: 'select', options: [{ value: 'new', label: 'A new workflow' }, { value: 'replace', label: 'Replace an existing workflow (new draft)' }], default: 'new' },
    { name: 'trigger', label: 'Start (new workflow)', type: 'select', options: [{ value: 'auto', label: 'As in Nintex (site workflows: schedule)' }, { value: 'manual', label: 'Manually / by API' }, { value: 'schedule', label: 'On a schedule' }], default: 'auto' },
    { name: 'workflow_id', label: 'Workflow to replace', type: 'string' },
    { name: 'workflow', label: 'Which workflow of the upload (name)', type: 'string' },
    { name: 'name', label: 'Name (new workflow)', type: 'string' },
    { name: 'target_config', label: 'Target settings', type: 'string' },
    { name: 'conflicts', label: 'Other workflows on the same events', type: 'select', options: [{ value: 'keep_both', label: 'Keep both' }, { value: 'remove_from_other', label: 'Remove the events from the other workflow' }], default: 'keep_both' },
    { name: 'forms', label: 'Nintex Forms', type: 'select', options: [{ value: 'new', label: 'New forms' }, { value: 'skip', label: 'Do not import' }, { value: 'replace', label: 'Replace an existing form (new draft)' }], default: 'new' },
    { name: 'form_id', label: 'Form to replace', type: 'string' },
    { name: 'confirm', label: 'Confirm replacing', type: 'boolean' },
    { name: 'keep_trigger', label: 'Keep the trigger of the workflow replaced (it already is bound to the target)', type: 'boolean' },
    { name: 'assignee_map', label: 'Assignee mapping (Nintex name → user:<id> | team:<id> | initiator | manager)', type: 'string' },
  ] as ImporterContribution['options'],
}

/* ── files ── */

export interface NintexUpload {
  workflows: Array<{ file: string; wf: NintexWorkflow }>
  forms: NintexFormModel[]
  /** Files read but not converted (user defined actions, unknown entries). */
  notes: string[]
}

async function unzip(bytes: Uint8Array) {
  const { unpackArchive } = await import('@/lib/importers/archive')
  return unpackArchive(bytes, { maxFiles: 500, maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 96 * 1024 * 1024 }).entries
}

export async function readNintexFiles(files: ImportFile[]): Promise<NintexUpload> {
  const out: NintexUpload = { workflows: [], forms: [], notes: [] }
  const zipEntries = new Map<Uint8Array, Array<{ name: string; bytes: Uint8Array }>>()
  const readOne = async (name: string, bytes: Uint8Array, depth: number) => {
    const lower = name.toLowerCase()
    if (lower.endsWith('.nwf') || lower.endsWith('.xml')) {
      out.workflows.push({ file: name, wf: parseNwf(decodeText(bytes), name) })
    } else if (lower.endsWith('.nwp')) {
      let entries: Array<{ name: string; bytes: Uint8Array }> = []
      const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b
      if (!isGzip) { entries = await unzip(bytes); zipEntries.set(bytes, entries) }
      out.workflows.push({ file: name, wf: isGzip ? parseNwpBytes(bytes, name, () => []) : parseNwpEntries(entries, name) })
      for (const e of entries.filter((x) => /(^|\/)Forms\/[^/]+\.(xml|json)$/i.test(x.name))) {
        try { out.forms.push({ ...parseNintexForm(e.bytes, e.name), name: `${name.replace(/\.nwp$/i, '')} – ${e.name.split('/').pop()!.replace(/\.(xml|json)$/i, '')}` }) } catch (error) { out.notes.push(`${name}: form ${e.name} could not be read (${(error as Error).message})`) }
      }
    } else if (lower.endsWith('.zip') && depth === 0) {
      for (const e of await unzip(bytes)) {
        const inner = e.name.toLowerCase()
        if (inner.endsWith('.nwf') || inner.endsWith('.nwp')) await readOne(e.name.split('/').pop()!, e.bytes, 1)
        else if (inner.endsWith('.uda')) out.notes.push(`${e.name.split('/').pop()}: a Nintex user defined action — the workflows using it get a placeholder for it (rebuild it as a sub-workflow)`)
      }
    } else {
      out.notes.push(`${name}: not a Nintex workflow export`)
    }
  }
  for (const f of files) {
    try { await readOne(f.name, f.bytes, 0) } catch (error) {
      if (error instanceof NintexFormatError) throw ServiceError.validation(error.message)
      if (error instanceof ServiceError) throw error
      if ((error as { code?: string })?.code === 'invalid_archive') throw ServiceError.validation(`${f.name}: ${(error as Error).message}`)
      throw ServiceError.validation(`${f.name} could not be read: ${(error as Error).message}`)
    }
  }
  if (!out.workflows.length && !out.forms.length) throw ServiceError.validation('No Nintex workflow found: import a .nwf, a .nwp or a zip of them')
  return out
}

/* ── options ── */

export interface NintexOptions {
  target: string
  trigger: 'auto' | 'manual' | 'schedule'
  workflowId: string | null
  workflow: string | null
  name: string | null
  targetConfig: Record<string, unknown>
  conflicts: 'keep_both' | 'remove_from_other'
  forms: 'new' | 'skip' | 'replace'
  formId: string | null
  confirm: boolean
  keepTrigger: boolean
  assigneeMap: Record<string, string>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function nintexOptions(raw: Record<string, unknown>): NintexOptions {
  const s = (k: string) => (typeof raw[k] === 'string' ? String(raw[k]).trim() : '')
  let targetConfig: Record<string, unknown> = {}
  const tc = raw.target_config
  if (tc && typeof tc === 'object' && !Array.isArray(tc)) targetConfig = tc as Record<string, unknown>
  else if (typeof tc === 'string' && tc.trim()) { try { const v = JSON.parse(tc); if (v && typeof v === 'object' && !Array.isArray(v)) targetConfig = v } catch { throw ServiceError.validation('target_config must be a JSON object') } }
  const target = s('target') || 'new'
  if (!/^(new|replace|ext\.[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*)$/.test(target)) throw ServiceError.validation('target must be new, replace or an extension target (ext.<extension>.<key>)')
  const workflowId = s('workflow_id') || null
  if (workflowId && !UUID_RE.test(workflowId)) throw ServiceError.validation('workflow_id must be a workflow id')
  if (target === 'replace' && !workflowId) throw ServiceError.validation('Choose the workflow to replace (workflow_id)')
  const formId = s('form_id') || null
  if (formId && !UUID_RE.test(formId)) throw ServiceError.validation('form_id must be a form id')
  const forms = (['new', 'skip', 'replace'].includes(s('forms')) ? s('forms') : 'new') as NintexOptions['forms']
  if (forms === 'replace' && !formId) throw ServiceError.validation('Choose the form to replace (form_id)')
  return {
    target, trigger: (['manual', 'schedule'].includes(s('trigger')) ? s('trigger') : 'auto') as NintexOptions['trigger'],
    workflowId, workflow: s('workflow') || null, name: s('name').slice(0, 200) || null, targetConfig,
    conflicts: s('conflicts') === 'remove_from_other' ? 'remove_from_other' : 'keep_both', forms, formId,
    confirm: raw.confirm === true || raw.confirm === 'true',
    keepTrigger: raw.keep_trigger === true || raw.keep_trigger === 'true',
    assigneeMap: (() => {
      const m = raw.assignee_map
      const obj = m && typeof m === 'object' && !Array.isArray(m) ? m : typeof m === 'string' && m.trim() ? (() => { try { return JSON.parse(m) } catch { throw ServiceError.validation('assignee_map must be a JSON object') } })() : {}
      return Object.fromEntries(Object.entries(obj as Record<string, unknown>).filter(([k, v]) => k && typeof v === 'string').map(([k, v]) => [normalizeRef(k), String(v)]))
    })(),
  }
}

/* ── extension targets ── */

async function extensionHooks(ctx: ServiceContext): Promise<Array<{ extensionId: string; name: string; hook: NintexImportHook }>> {
  const { hasExtensions, getExtensionManifest } = await import('@/lib/extensions/registry')
  if (!hasExtensions() || !ctx.tenantId) return []
  const [{ getServerExtensions }, { extensionAccess }] = await Promise.all([import('@/lib/extensions/server-registry'), import('@/lib/extensions/state')])
  const out: Array<{ extensionId: string; name: string; hook: NintexImportHook }> = []
  for (const server of getServerExtensions()) {
    const hook = server.nintex
    if (!hook || typeof hook.targets !== 'function' || typeof hook.plan !== 'function') continue
    if (!(await extensionAccess(ctx.tenantId, server.id, hook.feature)).usable) continue
    out.push({ extensionId: server.id, name: getExtensionManifest(server.id)?.name ?? server.id, hook })
  }
  return out
}

async function extensionContext(ctx: ServiceContext, extensionId: string) {
  const { createExtensionContext } = await import('@/lib/extensions/host')
  return createExtensionContext({ extensionId, tenantId: ctx.tenantId, actorId: ctx.actorId ?? ctx.credentialOwnerId ?? null, db: ctx.supabase, permissions: ctx.permissions })
}

/** Targets for "Where should this go?": the core ones and every usable extension's. */
export async function listNintexTargets(ctx: ServiceContext) {
  const targets: Array<{ id: string; label: string; description: string | null; extension: string | null; fields: unknown[] }> = [
    { id: 'new', label: 'A new workflow', description: 'Standalone: started manually / by API, or on a schedule. SharePoint list actions become placeholders.', extension: null, fields: [] },
    { id: 'replace', label: 'Replace an existing workflow', description: 'A new draft of the workflow you pick: same name, versions and run history. Publish it after review.', extension: null, fields: [] },
  ]
  for (const { extensionId, name, hook } of await extensionHooks(ctx)) {
    try {
      for (const t of await hook.targets({ ctx: await extensionContext(ctx, extensionId) })) {
        targets.push({ id: `ext.${extensionId}.${t.key}`, label: t.label, description: t.description ?? null, extension: name, fields: t.fields ?? [] })
      }
    } catch (error) {
      console.warn(`[nintex-import] targets of "${extensionId}" failed:`, error instanceof Error ? error.message : error)
    }
  }
  return targets
}

/**
 * The target a workflow is bound to (its extension trigger, NintexImportHook.boundTarget): the
 * embedded designer's default "Connect to this list" — imported as a new draft of that workflow,
 * its trigger kept. Null for workflows on core triggers or extensions without the hook.
 */
export async function boundNintexTarget(ctx: ServiceContext, workflowId: string) {
  if (!UUID_RE.test(workflowId)) throw ServiceError.validation('workflow_id must be a workflow id')
  const { getWorkflowDefinition } = await import('@/lib/services/workflows')
  const def: any = await getWorkflowDefinition(ctx, workflowId)
  const m = /^ext\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9_]*)$/.exec(String(def.trigger_type ?? ''))
  if (!m) return null
  const found = (await extensionHooks(ctx)).find((h) => h.extensionId === m[1])
  if (!found || typeof found.hook.boundTarget !== 'function') return null
  const triggerNode = (Array.isArray(def.nodes) ? def.nodes : []).find((n: any) => n?.type === def.trigger_type)
  const config = (triggerNode?.config && typeof triggerNode.config === 'object' ? triggerNode.config : def.trigger_config ?? {}) as Record<string, unknown>
  try {
    const bound = await found.hook.boundTarget({ ctx: await extensionContext(ctx, m[1]), workflow: { id: workflowId, name: String(def.name ?? ''), trigger: m[2], config } })
    if (!bound || !/^[a-z][a-z0-9_]*$/.test(bound.target)) return null
    return { id: `ext.${m[1]}.${bound.target}`, label: bound.label, description: bound.description ?? null, extension: found.name, config: bound.config ?? {}, workflow: { id: workflowId, name: String(def.name ?? '') } }
  } catch (error) {
    console.warn(`[nintex-import] bound target of "${m[1]}" failed:`, error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Add the missing columns the person confirmed to an extension target (NintexImportHook.createColumns:
 * the extension checks the person may change the list). Audited; the dialog analyses again after.
 */
export async function createNintexColumns(ctx: ServiceContext, input: { target: string; target_config?: unknown; columns: unknown }) {
  const target = String(input.target ?? '')
  const m = /^ext\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9_]*)$/.exec(target)
  if (!m) throw ServiceError.validation('Columns can be added to an extension target only (ext.<extension>.<key>)')
  const config = nintexOptions({ target, target_config: input.target_config }).targetConfig
  const KINDS = new Set(['text', 'note', 'number', 'currency', 'integer', 'datetime', 'boolean', 'choice', 'multichoice', 'person', 'people', 'lookup', 'lookupmulti', 'url', 'calculated', 'system', 'other'])
  const columns = (Array.isArray(input.columns) ? input.columns : []).slice(0, 50).map((c: any) => ({
    key: String(c?.key ?? '').trim().slice(0, 64),
    label: String(c?.label ?? '').trim().slice(0, 255),
    kind: String(c?.kind ?? ''),
    ...(Array.isArray(c?.choices) ? { choices: c.choices.map((x: unknown) => String(x).trim().slice(0, 255)).filter(Boolean).slice(0, 200) } : {}),
    ...(typeof c?.description === 'string' && c.description.trim() ? { description: c.description.trim().slice(0, 255) } : {}),
  }))
  if (!columns.length) throw ServiceError.validation('Choose the columns to add')
  for (const c of columns) {
    if (!c.key || !c.label) throw ServiceError.validation('Every column needs a name')
    if (!KINDS.has(c.kind)) throw ServiceError.validation(`${c.label}: unknown column type "${c.kind}"`)
  }
  const found = (await extensionHooks(ctx)).find((h) => h.extensionId === m[1])
  if (!found || typeof found.hook.createColumns !== 'function') throw ServiceError.validation('This target cannot add columns')
  const result = await found.hook.createColumns({ ctx: await extensionContext(ctx, m[1]), target: m[2], config, columns: columns as any })
  const { audit } = await import('@/lib/services/_shared')
  await audit(ctx, { objectType: 'workflow', objectId: m[1], action: 'update', summary: `Nintex import: added ${result.created.length} column(s) to ${target}${result.created.length ? `: ${result.created.map((c) => c.label).join(', ')}` : ''}${result.failed.length ? ` (${result.failed.length} failed)` : ''}`, metadata: { target, config, created: result.created, failed: result.failed } }).catch(() => undefined)
  return { created: result.created.slice(0, 50), failed: result.failed.slice(0, 50) }
}

/** "Create a <list> for this workflow" (NintexImportHook.createTargetInfo of a usable extension), or null. */
export async function nintexCreateTargetInfo(ctx: ServiceContext, workflowId?: string | null) {
  let workflow: { id: string; trigger: string; config: Record<string, unknown>; extension: string } | null = null
  if (workflowId) {
    if (!UUID_RE.test(workflowId)) throw ServiceError.validation('workflow_id must be a workflow id')
    const { getWorkflowDefinition } = await import('@/lib/services/workflows')
    const def: any = await getWorkflowDefinition(ctx, workflowId)
    const m = /^ext\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9_]*)$/.exec(String(def.trigger_type ?? ''))
    const node = (Array.isArray(def.nodes) ? def.nodes : []).find((n: any) => n?.type === def.trigger_type)
    if (m) workflow = { id: workflowId, trigger: m[2], extension: m[1], config: (node?.config ?? def.trigger_config ?? {}) as Record<string, unknown> }
  }
  for (const h of await extensionHooks(ctx)) {
    if (typeof h.hook.createTargetInfo !== 'function' || typeof h.hook.createTarget !== 'function') continue
    try {
      const info = await h.hook.createTargetInfo({ ctx: await extensionContext(ctx, h.extensionId), workflow: workflow && workflow.extension === h.extensionId ? { id: workflow.id, trigger: workflow.trigger, config: workflow.config } : null })
      if (info) return { extension: h.extensionId, extensionName: h.name, ...info }
    } catch (error) {
      console.warn(`[nintex-import] create-target info of "${h.extensionId}" failed:`, error instanceof Error ? error.message : error)
    }
  }
  return null
}

/** Create (or connect an existing) record type for the import (NintexImportHook.createTarget). Audited. */
export async function createNintexTarget(ctx: ServiceContext, extensionId: string, raw: Record<string, unknown>) {
  const found = (await extensionHooks(ctx)).find((h) => h.extensionId === extensionId)
  if (!found || typeof found.hook.createTarget !== 'function') throw ServiceError.validation('This extension cannot create a target here')
  const name = String(raw.name ?? '').trim().slice(0, 255)
  if (!name) throw ServiceError.validation('Give it a name')
  const container = String(raw.container ?? '').trim().slice(0, 200)
  if (!container) throw ServiceError.validation('Choose where to create it')
  const requestId = String(raw.request_id ?? '').trim()
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw ServiceError.validation('request_id is required')
  const KINDS = new Set(['text', 'note', 'number', 'currency', 'integer', 'datetime', 'boolean', 'choice', 'multichoice', 'person', 'people', 'lookup', 'lookupmulti', 'url', 'calculated', 'system', 'other'])
  const columns = (Array.isArray(raw.columns) ? raw.columns : []).slice(0, 100).map((c: any) => ({
    key: String(c?.key ?? '').trim().slice(0, 64), label: String(c?.label ?? '').trim().slice(0, 255), kind: String(c?.kind ?? 'text'),
    ...(c?.required === true ? { required: true } : {}),
    ...(Array.isArray(c?.choices) ? { choices: c.choices.map((x: unknown) => String(x).trim().slice(0, 255)).filter(Boolean).slice(0, 200) } : {}),
    ...(typeof c?.description === 'string' && c.description.trim() ? { description: c.description.trim().slice(0, 255) } : {}),
  }))
  for (const c of columns) {
    if (!c.key || !c.label) throw ServiceError.validation('Every column needs a display name and an internal name')
    if (!KINDS.has(c.kind)) throw ServiceError.validation(`${c.label}: unknown column type "${c.kind}"`)
  }
  const result = await found.hook.createTarget({ ctx: await extensionContext(ctx, extensionId), input: { name, container, kind: String(raw.kind ?? '').slice(0, 40), columns: columns as any, ifExists: raw.if_exists === 'use' ? 'use' : 'fail', requestId } })
  if (!/^[a-z][a-z0-9_]*$/.test(String(result.target))) throw ServiceError.validation('The extension returned an invalid target')
  const { audit } = await import('@/lib/services/_shared')
  await audit(ctx, { objectType: 'workflow', objectId: extensionId, action: result.existing ? 'update' : 'create', summary: `Nintex import: ${result.existing ? 'connected the existing' : 'created'} "${result.title}" (${result.created.length} column(s) added${result.failed.length ? `, ${result.failed.length} failed` : ''})`, metadata: { extension: extensionId, container, created: result.created, failed: result.failed, existing: result.existing } }).catch(() => undefined)
  return { id: `ext.${extensionId}.${result.target}`, config: result.config ?? {}, title: result.title, existing: result.existing, created: result.created.slice(0, 100), failed: result.failed.slice(0, 100), url: result.url ?? null, notes: (result.notes ?? []).slice(0, 20) }
}

/* ── plan ── */

interface Plan {
  wf: NintexWorkflow
  file: string
  mapped: MappedNintex
  trigger: { type: string; config: Record<string, unknown>; label: string } | null
  extensionPlan: NintexTargetPlan | null
  replacing: { id: string; name: string; triggerType: string; published: boolean; unpublishedChanges: boolean } | null
  /** The replaced workflow keeps its trigger (bound target, or the workflow that already covers the target's events). */
  keepTrigger: boolean
  columns: ColumnCheck | null
  warnings: string[]
}

function startOf(wf: NintexWorkflow): NintexStartOptions {
  return { manual: wf.startManually, onCreate: wf.startOnCreate, onChange: wf.startOnChange, conditions: wf.startConditions, workflowType: wf.workflowType }
}

async function replacingInfo(ctx: ServiceContext, workflowId: string): Promise<NonNullable<Plan['replacing']>> {
  const { getWorkflowDefinition } = await import('@/lib/services/workflows')
  const def: any = await getWorkflowDefinition(ctx, workflowId)
  const { data } = await (ctx.supabase as any).from('workflows').select('published_version_id, has_unpublished_changes').eq('tenant_id', ctx.tenantId).eq('id', workflowId).maybeSingle()
  return { id: workflowId, name: String(def.name), triggerType: String(def.trigger_type), published: Boolean(data?.published_version_id), unpublishedChanges: Boolean(data?.published_version_id) && data?.has_unpublished_changes === true }
}

async function planWorkflow(ctx: ServiceContext, wf: NintexWorkflow, file: string, opts: NintexOptions): Promise<Plan> {
  const warnings: string[] = []
  let replacing: Plan['replacing'] = null
  if (opts.workflowId && (opts.target === 'replace' || opts.target.startsWith('ext.'))) replacing = await replacingInfo(ctx, opts.workflowId)
  let keepTrigger = Boolean(replacing) && opts.keepTrigger && opts.target.startsWith('ext.')
  let extensionPlan: NintexTargetPlan | null = null
  let env: NintexMapEnv = {}
  let trigger: Plan['trigger'] = null
  let columns: ColumnCheck | null = null
  if (opts.target.startsWith('ext.')) {
    const [, extensionId, key] = opts.target.split('.')
    const found = (await extensionHooks(ctx)).find((h) => h.extensionId === extensionId)
    if (!found) throw ServiceError.validation(`The target ${opts.target} is not available here (is the extension enabled and licensed?)`)
    const extCtx = await extensionContext(ctx, extensionId)
    extensionPlan = await found.hook.plan({ ctx: extCtx, target: key, config: opts.targetConfig, start: startOf(wf), workflowName: wf.name, replacingWorkflowId: replacing?.id ?? null })
    // One workflow per event: the workflow that already covers the target becomes the one replaced (its trigger kept).
    if (!replacing && extensionPlan.into?.workflowId && UUID_RE.test(extensionPlan.into.workflowId)) {
      replacing = await replacingInfo(ctx, extensionPlan.into.workflowId)
      keepTrigger = true
      warnings.push(`"${replacing.name}" already runs on these events: the import becomes its new draft (one workflow per event)`)
    }
    const { getExtensionManifest } = await import('@/lib/extensions/registry')
    const declared = getExtensionManifest(extensionId)?.contributes.triggers.find((t) => t.key === extensionPlan!.trigger.key)
    if (!declared) throw ServiceError.validation(`The ${opts.target} target names an unknown trigger`)
    trigger = keepTrigger ? null : { type: `ext.${extensionId}.${declared.key}`, config: extensionPlan.trigger.config ?? {}, label: extensionPlan.trigger.label ?? declared.label }
    if (typeof found.hook.columns === 'function') {
      try {
        const target = await found.hook.columns({ ctx: extCtx, target: key, config: opts.targetConfig })
        if (target) columns = checkColumns(collectColumnRefs(wf, { aliases: target.aliases }), target)
      } catch (error) {
        warnings.push(`The list's columns could not be checked: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    env = { sharepoint: true, firstStep: extensionPlan.firstStep ?? null, listAction: extensionPlan.listAction ? (a) => extensionPlan!.listAction!(a) : undefined, otherAction: extensionPlan.otherAction ? (a) => extensionPlan!.otherAction!(a) : undefined, columnMap: columns?.columnMap }
    warnings.push(...(extensionPlan.warnings ?? []))
    // The trigger is kept: the target's event overlaps were answered when it was set (publishing asks again).
    if (keepTrigger) extensionPlan = { ...extensionPlan, conflicts: [] }
  } else {
    // No target of an extension: its own Nintex actions still map (their list left to choose).
    for (const h of await extensionHooks(ctx)) {
      if (typeof h.hook.unbound !== 'function') continue
      try {
        const m = await h.hook.unbound({ ctx: await extensionContext(ctx, h.extensionId) })
        if (m?.otherAction) { env = { ...env, otherAction: (a) => m.otherAction!(a) }; break }
      } catch (error) {
        console.warn(`[nintex-import] unbound mapping of "${h.extensionId}" failed:`, error instanceof Error ? error.message : error)
      }
    }
  }
  if (opts.target === 'new') {
    const schedule = opts.trigger === 'schedule' || (opts.trigger === 'auto' && wf.workflowType === 'Site')
    trigger = schedule
      ? { type: 'schedule', config: { schedule_mode: 'daily', time_of_day: '08:00', timezone: 'UTC' }, label: 'Schedule' }
      : { type: 'webhook_received', config: {}, label: 'Started manually / by API' }
    if (schedule) warnings.push(`${wf.name}: Nintex schedules are not part of the export — the workflow runs daily at 08:00 UTC until you set its schedule`)
    if (wf.workflowType !== 'Site' && (wf.startOnCreate || wf.startOnChange)) warnings.push(`${wf.name}: in Nintex it started when a list item was ${[wf.startOnCreate && 'created', wf.startOnChange && 'changed'].filter(Boolean).join(' or ')}; as a standalone workflow it starts manually / by API (import it onto a connected SharePoint list to keep that)`)
  }
  if (replacing?.unpublishedChanges) warnings.push(`"${replacing.name}" has unpublished changes: they are replaced by the import (the published version keeps running until you publish)`)
  if (wf.startConditions) warnings.push(`${wf.name}: Nintex start conditions are not converted — add them as a condition after the trigger`)
  const mapped = mapNintex(wf, env)
  if (!mapped.counts.actions) warnings.push(`${wf.name}: no actions were read — check the file`)
  if (mapped.constants.length) warnings.push(`${wf.name}: workflow constants ${mapped.constants.join(', ')} became variables const_… — set their values (credentials belong in a connection or secret)`)
  if (columns) {
    const flagged = flagMissingColumns(mapped.nodes as Array<{ config: Record<string, unknown> }>, columns.rows, columns.title)
    for (const r of columns.rows) {
      if (r.status === 'matched' && !r.note) continue
      mapped.items.push({ kind: 'column', name: r.display, status: r.status === 'matched' ? 'info' : 'partial', mappedTo: r.column ? `column ${r.column.label} (${r.column.key})` : 'missing column', detail: r.status === 'missing' ? `not on "${columns.title}": add it to the list, or change the steps that use it (${r.actions.join(', ') || 'lookups'})` : r.note })
    }
    if (columns.counts.missing) warnings.push(`${columns.counts.missing} column(s) the workflow uses are not on "${columns.title}"${flagged ? `: ${flagged} step(s) are flagged in the designer` : ''}`)
  }
  return { wf, file, mapped, trigger, extensionPlan, replacing, keepTrigger, columns, warnings }
}

function pickWorkflows(upload: NintexUpload, opts: NintexOptions) {
  if (!opts.workflowId) return upload.workflows
  const hit = opts.workflow ? upload.workflows.find((w) => w.wf.name.toLowerCase() === opts.workflow!.toLowerCase() || w.file.toLowerCase() === opts.workflow!.toLowerCase()) : upload.workflows[0]
  if (!hit) throw ServiceError.validation(`No workflow "${opts.workflow}" in the upload`)
  return [hit]
}

/* ── report ── */

function buildReport(upload: NintexUpload, plans: Plan[], opts: NintexOptions, formsPlan: { forms: NintexFormModel[]; replacing: string | null }, assignees: unknown[] = []): ImportReport {
  const items: ImportReportItem[] = plans.flatMap((p) => p.mapped.items.map((i) => (plans.length > 1 ? { ...i, location: p.wf.name } : i)))
  for (const f of formsPlan.forms) {
    items.push({ kind: 'form', name: f.name, status: f.skipped.length || f.rules ? 'partial' : 'mapped', mappedTo: formsPlan.replacing ? 'form (new draft of the chosen form)' : 'form', detail: `${f.fields.length} field(s) from ${f.kind} Nintex Forms${f.skipped.length ? `; not converted: ${f.skipped.slice(0, 8).map((s) => s.control).join(', ')}${f.skipped.length > 8 ? '…' : ''}` : ''}${f.rules ? `; ${f.rules} rule(s) to rebuild` : ''}` })
  }
  const coverage = importCoverage(items)
  const score = plans.length ? Math.max(...plans.map((p) => p.mapped.score)) : 10
  const where = opts.target === 'new' ? 'new workflow(s)' : opts.target === 'replace' ? `a new draft of "${plans[0]?.replacing?.name}"` : `${opts.target}${plans[0]?.replacing ? ` replacing "${plans[0].replacing.name}"` : ''}`
  const conflicts = plans.flatMap((p) => p.extensionPlan?.conflicts ?? [])
  const details = {
    target: opts.target,
    workflows: plans.map((p) => ({
      name: p.wf.name, file: p.file, format: p.wf.format, workflowType: p.wf.workflowType, start: startOf(p.wf),
      trigger: p.trigger ? { type: p.trigger.type, label: p.trigger.label, config: p.trigger.config } : p.replacing ? { type: p.replacing.triggerType, label: 'kept' } : null,
      keepTrigger: p.keepTrigger,
      columns: p.columns,
      startParameters: startParameters(p.wf.variables).map((x) => ({ name: x.name, label: x.label, type: x.format ?? x.type, required: Boolean(x.required) })),
      // For "Create a list for this workflow": every column it uses (and its start form fields), typed from use.
      columnsNeeded: columnsNeeded(p.wf),
      suggestedTarget: { name: (p.wf.listName || `${p.wf.name} items`).slice(0, 255), kind: usesDocuments(p.wf) ? 'library' : 'list' },
      actions: p.mapped.counts.actions, disabled: p.mapped.counts.disabled, steps: p.mapped.counts.steps, tasks: p.mapped.tasks, placeholders: p.mapped.placeholders,
      coverage: importCoverage(p.mapped.items).percent,
      replacing: p.replacing,
    })),
    conflicts,
    forms: formsPlan.forms.map((f) => ({ name: f.name, kind: f.kind, fields: f.fields.length, skipped: f.skipped.length, rules: f.rules })),
    needsConfirm: plans.some((p) => p.replacing) || Boolean(formsPlan.replacing),
    assignees,
  }
  return {
    title: plans.length === 1 ? plans[0].wf.name : plans.length ? `${plans.length} Nintex workflows` : `${formsPlan.forms.length} Nintex form(s)`,
    source: 'Nintex (.nwf / .nwp)',
    summary: `Becomes ${where}${formsPlan.forms.length ? ` and ${formsPlan.forms.length} form(s)` : ''}. Workflows are drafts: review the steps marked "To rebuild" / "Review", then publish.`,
    coverage,
    complexity: { score, level: importComplexityLevel(score), factors: plans.map((p) => `${p.wf.name}: ${p.mapped.counts.actions} action(s), ${p.mapped.tasks} task(s), ${p.mapped.placeholders} to rebuild`) },
    readiness: importReadiness(coverage, score),
    items,
    warnings: [...upload.notes, ...plans.flatMap((p) => p.warnings), ...conflicts.map((c) => `"${c.name}" also runs on ${c.detail}: choose keep both or remove the events from it`)],
    preview: false,
    outputs: [
      ...plans.map((p) => ({ kind: 'workflow' as const, name: p.replacing ? `${p.replacing.name} (new draft)` : opts.name && plans.length === 1 ? opts.name : p.wf.name, detail: `${p.mapped.counts.steps} steps${p.trigger ? ` · ${p.trigger.label}` : ''}` })),
      ...formsPlan.forms.map((f) => ({ kind: 'form' as const, name: f.name, detail: `${f.fields.length} fields` })),
    ],
    details,
  } as ImportReport
}

async function prepare(ctx: ServiceContext, files: ImportFile[], rawOptions: Record<string, unknown>) {
  const opts = nintexOptions(rawOptions)
  const upload = await readNintexFiles(files)
  const plans: Plan[] = []
  for (const w of pickWorkflows(upload, opts)) plans.push(await planWorkflow(ctx, w.wf, w.file, opts))
  // Task assignees → workspace people / teams (the preview's mapping step overrides).
  const refs = plans.flatMap((pl) => pl.mapped.assignees.flatMap((a) => a.refs))
  const resolved = refs.length ? await resolveAssignees(ctx, refs, opts.assigneeMap) : new Map<string, AssigneeResolution | null>()
  for (const pl of plans) {
    for (const a of pl.mapped.assignees) {
      const node = pl.mapped.nodes.find((n) => n.id === a.nodeId)
      const r = assignmentConfig(a.refs, resolved)
      if (node) node.config = { ...(node.config as Record<string, unknown>), ...r.config }
      const item = pl.mapped.items[a.item]
      if (!item) continue
      const who = r.resolved.length ? `assigned to ${r.resolved[0].label}${r.resolved.length > 1 ? ` (+${r.resolved.length - 1} more in Nintex: add them, or use a team)` : ''}` : 'choose the assignee'
      const left = r.unresolved.length ? `; not found here: ${r.unresolved.join(', ')} (map them in the preview)` : ''
      const exact = r.resolved.length > 0 && !r.unresolved.length && r.resolved.length === 1 && r.resolved[0].kind !== 'variable' && !a.behaviours.length
      item.status = exact ? 'mapped' : 'partial'
      item.detail = `${String(item.detail ?? '').split(':')[0]}: ${who}${left}${a.behaviours.length ? `; also had ${a.behaviours.join(', ')}` : ''}${r.resolved[0]?.kind === 'variable' ? '; the variable must hold a user id' : ''}`
    }
  }
  const assigneeSummary = [...new Set(refs.map(normalizeRef).filter(Boolean))].map((name) => {
    const r = resolved.get(name) ?? null
    return { name, tasks: plans.reduce((n, pl) => n + pl.mapped.assignees.filter((a) => a.refs.map(normalizeRef).includes(name)).length, 0), resolved: r ? { kind: r.kind, label: r.label, ...('id' in r ? { id: r.id } : {}), ...('origin' in r && r.origin ? { origin: r.origin } : {}) } : null }
  })
  const forms = opts.forms === 'skip' ? [] : upload.forms
  if (opts.forms === 'replace' && forms.length !== 1) throw ServiceError.validation(`Replacing a form takes one form; the upload has ${forms.length}`)
  return { opts, upload, plans, formsPlan: { forms, replacing: opts.forms === 'replace' ? opts.formId : null }, assigneeSummary }
}

/* ── analyse / import ── */

export async function analyzeNintex(ctx: ServiceContext, files: ImportFile[], options: Record<string, unknown>): Promise<ImportReport> {
  const p = await prepare(ctx, files, options)
  return buildReport(p.upload, p.plans, p.opts, p.formsPlan, p.assigneeSummary)
}

export async function importNintex(ctx: ServiceContext, files: ImportFile[], options: Record<string, unknown>) {
  const p = await prepare(ctx, files, options)
  const report = buildReport(p.upload, p.plans, p.opts, p.formsPlan, p.assigneeSummary)
  if ((report.details as { needsConfirm: boolean }).needsConfirm && !p.opts.confirm) throw ServiceError.validation('Replacing needs confirmation: review the analysis, then import with confirm: true')
  const { createWorkflow, updateWorkflow } = await import('@/lib/services/workflows')
  const created: Array<{ kind: 'workflow' | 'form'; id: string; name: string; href: string }> = []
  const warnings: string[] = []
  for (const plan of p.plans) {
    const { nodes, edges } = plan.mapped
    const variables = plan.mapped.variables.map((v, i) => ({
      id: `v${i + 1}`, name: v.name, type: ['string', 'number', 'boolean', 'object', 'array'].includes(v.type) ? v.type : 'string', ...(v.type === 'date' ? { format: 'datetime' } : {}), defaultValue: '', description: v.description.slice(0, 300),
      // Start form fields: what the Run dialog / start page asks for.
      ...(v.start ? { label: v.start.label, ...(v.start.required ? { required: true } : {}), ...(v.start.format ? { format: v.start.format } : {}), ...(v.start.options?.length ? { options: v.start.options } : {}), ...(v.start.defaultValue ? { defaultValue: v.start.defaultValue } : {}) } : {}),
    }))
    if (plan.replacing) {
      const { getWorkflowDefinition } = await import('@/lib/services/workflows')
      const def: any = await getWorkflowDefinition(ctx, plan.replacing.id)
      const old = (def.nodes as any[]).find((n) => n?.type === def.trigger_type)
      const triggerNode = plan.trigger && !plan.keepTrigger
        ? { id: old?.id ?? 'trigger', type: plan.trigger.type, label: plan.trigger.label.slice(0, 120), position: old?.position ?? { x: 0, y: 0 }, config: plan.trigger.config }
        : old
      if (!triggerNode) throw ServiceError.validation(`"${plan.replacing.name}" has no trigger step to keep`)
      const tid = String(triggerNode.id)
      await updateWorkflow(ctx, plan.replacing.id, {
        nodes: [triggerNode, ...nodes] as any,
        edges: edges.map((e, i) => ({ id: `e${i + 1}`, ...e, source: e.source === 'trigger' ? tid : e.source })) as any,
        user_variables: variables as any,
        ...(plan.trigger && !plan.keepTrigger && plan.trigger.type !== def.trigger_type ? { trigger_type: plan.trigger.type, trigger_config: plan.trigger.config } : {}),
      } as any)
      created.push({ kind: 'workflow', id: plan.replacing.id, name: plan.replacing.name, href: `/automations/${plan.replacing.id}` })
    } else {
      const trigger = plan.trigger!
      const name = (p.opts.name && p.plans.length === 1 ? p.opts.name : plan.wf.name).slice(0, 200)
      const result = await createWorkflow(ctx, {
        name, description: `Imported from the Nintex workflow "${plan.wf.name}" (${plan.file}) — review the steps marked "To rebuild" / "Review", then publish.${plan.wf.description ? ` ${plan.wf.description}` : ''}`.slice(0, 2000),
        trigger_type: trigger.type, trigger_config: trigger.config,
        nodes: [{ id: 'trigger', type: trigger.type, label: trigger.label.slice(0, 120), position: { x: 0, y: 0 }, config: trigger.config }, ...nodes] as any,
        edges: edges.map((e, i) => ({ id: `e${i + 1}`, ...e })) as any,
        user_variables: variables as any, tags: ['nintex'],
      } as any)
      created.push({ kind: 'workflow', id: result.workflow_id, name, href: `/automations/${result.workflow_id}` })
    }
    if (plan.extensionPlan?.after) {
      try { warnings.push(...(await plan.extensionPlan.after({ workflowId: created[created.length - 1].id, conflictChoice: p.opts.conflicts }))) } catch (error) { warnings.push(`After the import: ${(error as Error).message}`) }
    }
  }
  if (p.formsPlan.forms.length) {
    const { createForm, updateForm } = await import('@/lib/services/forms')
    for (const f of p.formsPlan.forms) {
      if (!f.fields.length) { warnings.push(`${f.name}: no fields to import`); continue }
      if (p.formsPlan.replacing) {
        const row: any = await updateForm(ctx, p.formsPlan.replacing, { fields: f.fields } as any)
        created.push({ kind: 'form', id: String(row.id), name: String(row.name), href: `/automations/forms/${row.id}` })
      } else {
        const row: any = await createForm(ctx, { name: f.name.slice(0, 200), description: `Imported from Nintex Forms (${f.kind})`, fields: f.fields, tags: ['nintex'] } as any)
        created.push({ kind: 'form', id: String(row.id), name: String(row.name), href: `/automations/forms/${row.id}` })
      }
    }
  }
  return { report, created, warnings }
}
