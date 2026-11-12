/**
 * InfoPath import: an uploaded .xsn (or a zip of its source files) →
 * UserTasks forms. Shared by the Forms page importer (/api/internal/forms/
 * infopath), REST POST /api/v1/forms/import/infopath, the MCP tool
 * forms_import_infopath, the CLI (`forms import-infopath`) and the Agent.
 *
 *   analyze (dry run)   the report, the forms that would be made, earlier
 *                       imports of the same file — nothing is stored
 *   import              creates the forms (forms.edit) through the forms
 *                       service — validation, versions, audit, sync as usual —
 *                       or updates the ones an earlier import of this file
 *                       made (matched by layout.source: file name + view);
 *                       optionally a data table for the submissions (child
 *                       tables per List) and a "save to table" workflow
 *                       (data.create, workflows.create / edit; created
 *                       inactive, a draft to review). On a failure nothing
 *                       made by this import is kept.
 *
 * The file itself is never stored: it lives for the request that reads it.
 */

import { analyzeInfoPath } from '@/lib/infopath/analyze'
import { InfoPathFileError } from '@/lib/infopath/archive'
import { generateForms, reportMarkdown, type GenerateOptions, type GeneratedForm, type ImportMode, type ImportReport } from '@/lib/infopath/generate'
import type { InfoPathModel } from '@/lib/infopath/model'
import { formDesignerHref } from '@/lib/forms/designer-links'
import { valueFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { normalizeFormSource } from '@/lib/forms/form-source'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables are not in the generated Database types */

export interface InfoPathImportOptions {
  /** One form per view (default) or the views as steps of one form. */
  mode?: ImportMode
  /** Combined: the views as steps (default) or tabs. */
  pages?: 'steps' | 'tabs'
  /** Views to import (names); default all. */
  views?: string[]
  /** Base form name (default the InfoPath form's title). */
  name?: string
  /** An extra tag (the name and "infopath" are always added). */
  tag?: string
  /** Earlier imports of this file: update those forms (`update`) or make new ones (`new`, the default). */
  existing?: 'new' | 'update'
  /** Also create a data table for the submissions (child tables per List) and a draft "save to table" workflow. */
  create_table?: boolean
  /** List the forms in the Forms menu of people given access. */
  available_in_menu?: boolean
}

export interface ExistingImport { id: string; name: string; view: string | null; hash: string; imported_at: string | null; same_file: boolean }

export interface FormPreview {
  name: string
  view: string | null
  counts: GeneratedForm['counts']
  fields: Array<{ key: string; label: string; type: string; required?: boolean; columns?: number }>
  /** The existing form this one would update (existing: update). */
  updates?: { id: string; name: string } | null
  /** The generated definition (dry run): fields + layout, as POST /forms takes them. */
  definition?: { fields: TaskFieldDef[]; layout: unknown }
}

export interface InfoPathAnalysis {
  file_name: string
  hash: string
  report: ImportReport
  forms: FormPreview[]
  existing: ExistingImport[]
  /** Markdown of the report (download / the Agent). */
  markdown: string
}

export interface InfoPathImportResult extends InfoPathAnalysis {
  created: Array<{ id: string; name: string; view: string | null; href: string }>
  updated: Array<{ id: string; name: string; view: string | null; href: string }>
  table?: { id: string; name: string; child_tables: Array<{ id: string; name: string; list: string }> }
  workflow?: { id: string; name: string } | null
  warnings: string[]
}

const NAME_RE = /^[\w .,()&'-]{0,200}$/

function cleanOptions(raw: InfoPathImportOptions | undefined): InfoPathImportOptions {
  const o = raw ?? {}
  const out: InfoPathImportOptions = {}
  if (o.mode === 'combined' || o.mode === 'per_view') out.mode = o.mode
  if (o.pages === 'steps' || o.pages === 'tabs') out.pages = o.pages
  if (Array.isArray(o.views)) out.views = o.views.filter((v) => typeof v === 'string').map((v) => v.slice(0, 200)).slice(0, 40)
  if (typeof o.name === 'string' && o.name.trim()) {
    if (!NAME_RE.test(o.name.trim())) throw ServiceError.validation('The form name has characters that are not allowed')
    out.name = o.name.trim().slice(0, 100)
  }
  if (typeof o.tag === 'string' && o.tag.trim()) out.tag = o.tag.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 40)
  if (o.existing === 'update' || o.existing === 'new') out.existing = o.existing
  if (o.create_table === true) out.create_table = true
  if (typeof o.available_in_menu === 'boolean') out.available_in_menu = o.available_in_menu
  return out
}

/** Read the file into the model; analyzer errors become validation errors with their message. */
export function readInfoPath(bytes: Uint8Array, fileName: string): InfoPathModel {
  if (!bytes?.length) throw ServiceError.validation('No file was sent')
  try {
    return analyzeInfoPath(bytes, { fileName: fileName.replace(/[\\/]/g, '_').slice(0, 200) || 'form.xsn' })
  } catch (error) {
    if (error instanceof InfoPathFileError) throw ServiceError.validation(error.message, { infopath: { code: error.code } })
    throw error
  }
}

/** Data tables / API references whose name matches a data connection (case-insensitive). */
async function matchConnections(ctx: ServiceContext, model: InfoPathModel): Promise<GenerateOptions['connections']> {
  const names = [...new Set(model.manifest.connections.map((c) => c.name))]
  if (!names.length) return {}
  const out: NonNullable<GenerateOptions['connections']> = {}
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]))
  try {
    if (hasPerm(ctx, 'data.view')) {
      const { data } = await (ctx.supabase as any).from('custom_tables').select('id, name').eq('tenant_id', ctx.tenantId).limit(500)
      for (const t of (data ?? []) as Array<{ id: string; name: string }>) {
        const n = lower.get(String(t.name).toLowerCase())
        if (n && !out[n]) out[n] = { table_id: t.id, table_name: t.name }
      }
    }
    const { data: refs } = await (ctx.supabase as any).from('integration_references').select('id, name, integration_id').eq('tenant_id', ctx.tenantId).limit(500)
    for (const r of (refs ?? []) as Array<{ id: string; name: string; integration_id: string }>) {
      const n = lower.get(String(r.name).toLowerCase())
      if (n && !out[n]) out[n] = { reference_id: r.id, integration_id: r.integration_id }
    }
  } catch {
    // Matching is a convenience: without it the rules keep TODO notes.
  }
  return out
}

/** Forms an earlier import of this file made (layout.source, same file name or same content). */
async function earlierImports(ctx: ServiceContext, model: InfoPathModel): Promise<ExistingImport[]> {
  if (!hasPerm(ctx, 'forms.view')) return []
  const { data, error } = await (ctx.supabase as any).from('forms').select('id, name, layout').eq('tenant_id', ctx.tenantId)
    .eq('layout->source->>kind', 'infopath').limit(500)
  if (error) return []
  const out: ExistingImport[] = []
  for (const row of (data ?? []) as Array<{ id: string; name: string; layout: any }>) {
    const source = normalizeFormSource(row.layout?.source)
    if (!source) continue
    const sameFile = source.hash === model.hash
    if (!sameFile && source.file_name.toLowerCase() !== model.file_name.toLowerCase()) continue
    out.push({ id: row.id, name: row.name, view: source.view ?? null, hash: source.hash, imported_at: source.imported_at ?? null, same_file: sameFile })
  }
  return out
}

function preview(forms: GeneratedForm[], existing: ExistingImport[], options: InfoPathImportOptions, withDefinition: boolean): FormPreview[] {
  return forms.map((f) => {
    const match = options.existing === 'update' ? existing.find((e) => e.view === f.view) : undefined
    return {
      name: f.name,
      view: f.view,
      counts: f.counts,
      fields: f.input.fields.filter((x) => !['heading', 'divider'].includes(x.type)).slice(0, 300).map((x) => ({
        key: x.key, label: x.label, type: x.type, ...(x.required ? { required: true } : {}), ...(x.list ? { columns: x.list.columns.length } : {}),
      })),
      updates: match ? { id: match.id, name: match.name } : null,
      ...(withDefinition ? { definition: { fields: f.input.fields, layout: f.input.layout } } : {}),
    }
  })
}

async function prepare(ctx: ServiceContext, bytes: Uint8Array, fileName: string, rawOptions?: InfoPathImportOptions) {
  const options = cleanOptions(rawOptions)
  const model = readInfoPath(bytes, fileName)
  if (options.views?.length && !options.views.some((v) => model.views.some((x) => x.name === v))) throw ServiceError.validation('None of the chosen views are in this form')
  const connections = await matchConnections(ctx, model)
  const generated = generateForms(model, { mode: options.mode, pages: options.pages, views: options.views, name: options.name, tag: options.tag, connections })
  const existing = await earlierImports(ctx, model)
  return { options, model, generated, existing }
}

/** Analyse only: the report and what would be made. Needs forms.view (the importer is offered to forms.edit). */
export async function analyzeInfoPathFile(ctx: ServiceContext, bytes: Uint8Array, fileName: string, rawOptions?: InfoPathImportOptions, opts: { definitions?: boolean } = {}): Promise<InfoPathAnalysis> {
  requirePerm(ctx, 'forms.view')
  const { options, model, generated, existing } = await prepare(ctx, bytes, fileName, rawOptions)
  return {
    file_name: model.file_name,
    hash: model.hash,
    report: generated.report,
    forms: preview(generated.forms, existing, options, opts.definitions ?? false),
    existing,
    markdown: reportMarkdown(generated.report),
  }
}

/* ── data table + workflow ── */

const TABLE_TYPE: Partial<Record<TaskFieldDef['type'], string>> = {
  text: 'text', email: 'text', phone: 'text', url: 'text', textarea: 'longtext', number: 'number', currency: 'number',
  date: 'date', datetime: 'date', boolean: 'boolean', choice: 'select', multi_choice: 'text', user: 'text', attachments: 'file', label: 'text',
}
const LIST_TYPE: Record<string, string> = { text: 'text', textarea: 'longtext', number: 'number', currency: 'number', calculated: 'number', date: 'date', choice: 'select', boolean: 'boolean', email: 'text', lookup: 'text' }
const SYSTEM = new Set(['id', 'date_created', 'row_id', 'created_at', 'updated_at', 'created_by', 'reference', 'submitted_by', 'submitted_at', 'submission_id', 'form_name'])

function tableColumns(fields: TaskFieldDef[]) {
  const cols: Array<{ key: string; name: string; type: string; options?: string[] }> = [
    { key: 'reference', name: 'Reference', type: 'text' },
    { key: 'form_name', name: 'Form', type: 'text' },
    { key: 'submitted_by', name: 'Submitted by', type: 'text' },
    { key: 'submitted_at', name: 'Submitted at', type: 'date' },
    { key: 'submission_id', name: 'Submission id', type: 'text' },
  ]
  const names = new Set(cols.map((c) => c.name.toLowerCase()))
  for (const f of fields) {
    if (f.type === 'list' || SYSTEM.has(f.key)) continue
    const type = TABLE_TYPE[f.type]
    if (!type) continue
    let name = f.label.slice(0, 90) || f.key
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${f.label.slice(0, 85)} (${i})`
    names.add(name.toLowerCase())
    cols.push({ key: f.key, name, type, ...(type === 'select' && f.options?.length ? { options: f.options } : {}) })
  }
  return cols
}

function saveWorkflow(formName: string, formIds: Array<{ id: string; name: string }>, table: { id: string; name: string; columns: string[] }, lists: Array<{ key: string; label: string; table: { id: string; name: string }; columns: string[] }>) {
  // One workflow per form (a form_submitted trigger names one form).
  return formIds.map((form) => {
    const nodes: any[] = []
    const edges: any[] = []
    let y = 60
    const add = (node: any) => { nodes.push({ ...node, position: node.position ?? { x: 400, y } }); if (!node.position) y += 140; return node.id }
    add({ id: 'trigger', type: 'form_submitted', label: `"${form.name}" submitted`, config: { form_id: form.id, form_name: form.name } })
    const values: Record<string, string> = {}
    for (const c of table.columns) values[c] = `{{form.${c}}}`
    Object.assign(values, { reference: '{{submission.reference}}', form_name: form.name, submitted_by: '{{submitted_by_name}}', submitted_at: '{{submitted_at}}', submission_id: '{{form_submission_id}}' })
    add({ id: 'save', type: 'update_data_table', label: 'Save the submission', config: { table_id: table.id, table_name: table.name, operation: 'insert', column_values: values, output_row_id_var: 'parent_id' } })
    edges.push({ id: 'e-trigger-save', source: 'trigger', target: 'save' })
    let previous = 'save'
    lists.forEach((l, i) => {
      const loopId = `rows_${i + 1}`
      const insertId = `row_${i + 1}`
      add({ id: loopId, type: 'loop', label: `Each ${l.label}`, config: { items: `{{form.${l.key}}}`, item_var: 'item', index_var: 'index' } })
      const cv: Record<string, string> = { parent_id: '{{parent_id}}', reference: '{{submission.reference}}' }
      for (const c of l.columns) cv[c] = `{{item.${c}}}`
      add({ id: insertId, type: 'update_data_table', label: `Save a ${l.label} row`, position: { x: 700, y: y - 140 }, config: { table_id: l.table.id, table_name: l.table.name, operation: 'insert', column_values: cv } })
      edges.push({ id: `e-${previous}-${loopId}`, source: previous, target: loopId, ...(previous.startsWith('rows_') ? { label: 'Done' } : {}) })
      edges.push({ id: `e-${loopId}-${insertId}`, source: loopId, target: insertId, label: 'Each item' })
      previous = loopId
    })
    add({ id: 'done', type: 'end_workflow', label: 'Saved', config: { reason: 'Submission {{submission.reference}} saved' } })
    edges.push({ id: `e-${previous}-done`, source: previous, target: 'done', ...(previous.startsWith('rows_') ? { label: 'Done' } : {}) })
    return {
      name: `${form.name}: save submissions`.slice(0, 120),
      description: `Made by the InfoPath import of "${formName}": saves each submission of "${form.name}" in the "${table.name}" data table${lists.length ? ' (List rows in their child tables)' : ''}.`,
      trigger_type: 'form_submitted', trigger_config: {}, nodes, edges, tags: ['infopath'],
    }
  })
}

/** Import: create (or update) the forms, and optionally the table + workflow. */
export async function importInfoPathFile(ctx: ServiceContext, bytes: Uint8Array, fileName: string, rawOptions?: InfoPathImportOptions): Promise<InfoPathImportResult> {
  requirePerm(ctx, 'forms.edit')
  const pre = await prepare(ctx, bytes, fileName, rawOptions)
  const { options, model, generated, existing } = pre
  if (options.create_table) {
    requirePerm(ctx, 'data.create')
    if (!hasPerm(ctx, 'workflows.create')) requirePerm(ctx, 'workflows.edit')
  }
  const forms = await import('./forms')
  const created: InfoPathImportResult['created'] = []
  const updated: InfoPathImportResult['updated'] = []
  const undo: Array<() => Promise<unknown>> = []
  const warnings: string[] = []
  let table: InfoPathImportResult['table']
  let workflow: InfoPathImportResult['workflow'] = null
  try {
    // Pictures from the template (display images, default pictures) are stored as form images first.
    const storeImages = await imageStorer(ctx)
    for (const f of generated.forms) f.input.fields = await storeImages(f.input.fields) as TaskFieldDef[]
    for (const f of generated.forms) {
      const match = options.existing === 'update' ? existing.find((e) => e.view === f.view) : undefined
      if (match) {
        const before = await forms.getForm(ctx, match.id)
        const row = await forms.updateForm(ctx, match.id, { fields: f.input.fields, layout: f.input.layout, description: f.input.description, tags: f.input.tags })
        undo.push(() => forms.updateForm(ctx, match.id, { fields: before.fields, layout: before.layout, description: before.description, tags: before.tags }))
        updated.push({ id: row.id, name: row.name, view: f.view, href: formDesignerHref(row.id) })
      } else {
        const row = await forms.createForm(ctx, { ...f.input, ...(options.available_in_menu !== undefined ? { available_in_menu: options.available_in_menu } : {}) })
        undo.push(() => forms.deleteForm(ctx, row.id))
        created.push({ id: row.id, name: row.name, view: f.view, href: formDesignerHref(row.id) })
      }
    }
    if (options.create_table) {
      const dataTables = await import('./data-tables')
      const workflows = await import('./workflows')
      const allFields = new Map<string, TaskFieldDef>()
      for (const f of generated.forms) for (const x of valueFields(f.input.fields)) if (!allFields.has(x.key)) allFields.set(x.key, x)
      const baseName = generated.report.form.name
      const cols = tableColumns([...allFields.values()])
      const parent = await dataTables.createDataTable(ctx, { name: `${baseName} submissions`.slice(0, 120), description: `Submissions of the forms imported from InfoPath "${model.file_name}".`, columns: cols as any })
      undo.push(() => removeTable(ctx, parent.id))
      const lists = [...allFields.values()].filter((x) => x.type === 'list' && x.list)
      const children: Array<{ key: string; label: string; table: { id: string; name: string }; columns: string[] }> = []
      for (const l of lists) {
        const lcols = l.list!.columns.filter((c) => !SYSTEM.has(c.key)).map((c) => ({ key: c.key, name: c.label.slice(0, 90), type: LIST_TYPE[c.type] ?? 'text', ...(c.type === 'choice' && c.options?.length ? { options: c.options } : {}) }))
        const child = await dataTables.createDataTable(ctx, {
          name: `${baseName} — ${l.label}`.slice(0, 120),
          description: `Rows of "${l.label}" (a repeating table in InfoPath); parent_id is the submission's row in "${parent.name}".`,
          columns: [{ key: 'parent_id', name: 'Parent row', type: 'text' }, { key: 'reference', name: 'Reference', type: 'text' }, ...lcols] as any,
        })
        undo.push(() => removeTable(ctx, child.id))
        children.push({ key: l.key, label: l.label, table: { id: child.id, name: child.name }, columns: lcols.map((c) => c.key) })
      }
      table = { id: parent.id, name: parent.name, child_tables: children.map((c) => ({ id: c.table.id, name: c.table.name, list: c.key })) }
      const formsForWorkflow = [...created, ...updated]
      const defs = saveWorkflow(baseName, formsForWorkflow.map((f) => ({ id: f.id, name: f.name })), { id: parent.id, name: parent.name, columns: cols.filter((c) => !SYSTEM.has(c.key)).map((c) => c.key) }, children)
      for (const def of defs.slice(0, 1).concat(defs.slice(1))) {
        const wf = await workflows.createWorkflow(ctx, { ...def, is_active: false } as any)
        undo.push(() => removeWorkflow(ctx, wf.workflow_id))
        workflow ??= { id: wf.workflow_id, name: def.name }
      }
      if (defs.length > 1) warnings.push(`Made ${defs.length} draft "save submissions" workflows, one per form. Review and publish them in Automations → Workflows.`)
      else warnings.push('The "save submissions" workflow is a draft: review and publish it in Automations → Workflows.')
    }
  } catch (error) {
    for (const step of undo.reverse()) { try { await step() } catch (e) { console.warn('[infopath-import] rollback step failed:', e instanceof Error ? e.message : e) } }
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof ServiceError) throw new ServiceError(error.code, `The import stopped: ${message}. Nothing was kept.`, { details: error.details })
    throw new ServiceError('internal', `The import stopped: ${message}. Nothing was kept.`)
  }
  await audit(ctx, {
    objectType: 'form', objectId: created[0]?.id ?? updated[0]?.id ?? null,
    action: 'import',
    summary: `Imported the InfoPath form "${model.file_name}": ${created.length} created, ${updated.length} updated`,
    metadata: { file_name: model.file_name, hash: model.hash, mode: options.mode ?? 'per_view', created: created.map((c) => c.id), updated: updated.map((u) => u.id), rules: generated.report.summary.rules, table_id: table?.id ?? null },
  })
  return {
    file_name: model.file_name,
    hash: model.hash,
    report: generated.report,
    forms: preview(generated.forms, existing, options, false),
    existing,
    markdown: reportMarkdown(generated.report),
    created, updated,
    ...(table ? { table } : {}),
    workflow,
    warnings,
  }
}

/** Replace data: image URLs in fields (display images, image defaults; inside repeating sections too) with stored form images. */
async function imageStorer(ctx: ServiceContext): Promise<(fields: unknown) => Promise<unknown>> {
  const { uploadFormImage } = await import('./uploads')
  const cache = new Map<string, string>()
  const store = async (dataUrl: string, name: string): Promise<string | null> => {
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!m) return null
    const hit = cache.get(m[2])
    if (hit) return hit
    const bytes = Buffer.from(m[2], 'base64')
    const stored = await uploadFormImage(ctx, { name, type: m[1], bytes: new Uint8Array(bytes) })
    // A storage reference (resolved when shown) works with every provider, also a local http one.
    const { toStorageRef } = await import('@/lib/storage/refs')
    const ref = stored.ref ?? String(toStorageRef(stored.url))
    cache.set(m[2], ref)
    return ref
  }
  const walk = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(walk))
    if (!value || typeof value !== 'object') return value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((k === 'src' || k === 'url') && typeof v === 'string' && v.startsWith('data:image/')) out[k] = (await store(v, `${k}.img`)) ?? v
      else out[k] = await walk(v)
    }
    return out
  }
  return walk
}

async function removeTable(ctx: ServiceContext, id: string) {
  const db = await serviceRoleClient(ctx)
  await (db as any).from('custom_table_rows').delete().eq('tenant_id', ctx.tenantId).eq('table_id', id)
  const { error } = await (db as any).from('custom_tables').delete().eq('tenant_id', ctx.tenantId).eq('id', id)
  if (error) throw dbError(error)
}

async function removeWorkflow(ctx: ServiceContext, id: string) {
  const db = await serviceRoleClient(ctx)
  const { error } = await (db as any).from('workflows').delete().eq('tenant_id', ctx.tenantId).eq('id', id)
  if (error) throw dbError(error)
}

/** Decode a base64 upload (REST / MCP / the Agent), bounded. */
export function decodeBase64File(b64: string, maxBytes: number): Uint8Array {
  const clean = String(b64 ?? '').replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '')
  if (!clean) throw ServiceError.validation('file_base64 is empty')
  if (!/^[A-Za-z0-9+/]+=*$/.test(clean)) throw ServiceError.validation('file_base64 is not base64')
  if (Math.floor(clean.length * 3 / 4) > maxBytes + 3) throw ServiceError.validation(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
  return Buffer.from(clean, 'base64')
}
