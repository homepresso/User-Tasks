/**
 * Gallery catalog: what the /gallery pages show for each package, derived
 * from its sources and its build (requirements, assets, forms, inputs, the
 * workflow graph). Written to lib/gallery/catalog.json by the build so the
 * marketing site imports static data (no file-system reads at request time).
 * Signature-dependent values (signed, fingerprint, file hash) live only in
 * public/gallery/index.json, so the catalog is identical for signed and
 * unsigned builds.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { deriveInputFields } from '@/lib/workflow-inputs'
import type { BuiltGalleryPackage } from './build'
import { isNativeContents, releaseDate } from './build'
import type { GallerySource } from './source'
import type { GalleryMeta } from './types'

export interface CatalogField {
  key: string
  label: string
  type: string
  required: boolean
  options?: string[]
  description?: string
  /** Prefilled value (task fields; may be an expression). */
  default?: string
}

export interface CatalogForm {
  workflow: string
  step: string
  title: string
  outcomes: string[]
  fields: CatalogField[]
  /** 'task' (a User Task step's form) or 'page' (a reusable form with its own /f/ page). */
  kind?: 'task' | 'page'
  /** Button labels when the form has its own button bar. */
  buttons?: string[]
  /** Grid columns used by the widest row (1 = classic single column). */
  columns?: number
  /** The form has a mini theme / header of its own. */
  themed?: boolean
}

export interface CatalogWorkflow {
  id: string
  name: string
  description: string | null
  trigger_type: string
  entry: boolean
  nodes: any[]
  edges: any[]
  swimlanes: any[]
}

export interface CatalogRequirement {
  id: string
  kind: string
  label: string
  description: string
  required: boolean
  fields: Array<{ key: string; label: string; type: string; secret: boolean; required: boolean; default?: unknown }>
}

export interface CatalogEntry extends Omit<GalleryMeta, 'sample_input' | 'expect' | 'verify_mocks' | 'optional_needs' | 'systems'> {
  optional_needs: GalleryMeta['needs']
  systems: string[]
  /** "No integrations needed" (lib/gallery/build isNativeContents). */
  native: boolean
  released: string
  file_name: string
  checksum: string
  sample_input: Record<string, unknown>
  inputs: CatalogField[]
  forms: CatalogForm[]
  workflows: CatalogWorkflow[]
  assets: Array<{ section: string; name: string; description: string | null; detail?: string }>
  tables: Array<{ id: string; name: string; columns: string[]; rows: number }>
  requirements: CatalogRequirement[]
  asset_count: number
}

export interface GalleryCatalog {
  format_version: 1
  packages: CatalogEntry[]
}

const SECTION_LABEL: Record<string, string> = {
  workflows: 'Workflow', decision_tables: 'Decision table', data_tables: 'Data table', integrations: 'Integration',
  references: 'API reference', email_templates: 'Email template', agents: 'AI agent', workflow_activities: 'Custom step',
  reports: 'Report', roles: 'Role', retention_policies: 'Retention policy', objects: 'Object',
}

export function sectionLabel(section: string): string {
  return SECTION_LABEL[section] ?? section
}

function field(raw: any): CatalogField {
  const options = Array.isArray(raw?.options) ? raw.options.map((o: any) => String(typeof o === 'object' ? o?.label ?? o?.value : o)).filter(Boolean) : undefined
  return {
    key: String(raw?.key ?? raw?.name ?? ''),
    label: String(raw?.label ?? raw?.name ?? raw?.key ?? ''),
    type: String(raw?.type ?? 'text'),
    required: raw?.required === true,
    ...(options?.length ? { options } : {}),
    ...(raw?.description ? { description: String(raw.description) } : {}),
    ...(raw?.default !== undefined && raw?.default !== '' && raw?.default !== null ? { default: String(raw.default) } : {}),
  }
}

/** The entry workflow's inputs (its typed workflow variables): the start form. */
function inputsOf(workflow: any): CatalogField[] {
  return deriveInputFields(workflow?.user_variables ?? []).map((input) => ({
    key: input.key,
    label: input.label,
    type: input.type,
    required: input.required,
    ...(input.options?.length ? { options: input.options.map((o) => o.label) } : {}),
    ...(input.description ? { description: input.description } : {}),
  }))
}

/** The start form: the Form submitted trigger's form fields, or the entry workflow's inputs. */
function entryInputs(workflow: any, forms: any[]): CatalogField[] {
  if (workflow?.trigger_type === 'form_submitted') {
    const trigger = (workflow.nodes ?? []).find((n: any) => n?.type === 'form_submitted')
    const form = forms.find((f) => String(f.id) === String(trigger?.config?.form_id))
    return (form?.fields ?? []).filter((f: any) => !['heading', 'divider'].includes(f?.type)).map(field)
  }
  return inputsOf(workflow)
}

export function catalogEntry(source: GallerySource, built: BuiltGalleryPackage): CatalogEntry {
  const { meta } = source
  const assets = built.contents.assets
  const workflows: CatalogWorkflow[] = (assets.workflows ?? []).map((wf: any) => ({
    id: String(wf.id), name: String(wf.name), description: wf.description ?? null, trigger_type: String(wf.trigger_type),
    entry: String(wf.id) === meta.entry_workflow, nodes: wf.nodes ?? [], edges: wf.edges ?? [], swimlanes: wf.swimlanes ?? [],
  }))
  workflows.sort((a, b) => Number(b.entry) - Number(a.entry))
  const forms: CatalogForm[] = []
  const shape = (layout: any, theme: any, header: any, buttons: any) => {
    const columns = Math.max(1, ...((layout?.rows ?? []) as any[]).map((row) => Number(row?.columns) || 1))
    const themed = Boolean((theme && theme.source && theme.source !== 'workspace') || header?.enabled)
    const labels = Array.isArray(buttons) && buttons.length ? buttons.filter((b: any) => !b?.hidden).map((b: any) => String(b?.label ?? '')).filter(Boolean) : undefined
    return { ...(columns > 1 ? { columns } : {}), ...(themed ? { themed } : {}), ...(labels?.length ? { buttons: labels } : {}) }
  }
  for (const form of assets.forms ?? []) {
    forms.push({
      workflow: 'Form page', step: String(form.name), title: String(form.header?.title || form.name), outcomes: [],
      fields: (form.fields ?? []).filter((f: any) => !['heading', 'divider'].includes(f?.type)).map(field), kind: 'page',
      ...shape(form.layout, form.theme, form.header, form.buttons),
    })
  }
  for (const wf of workflows) {
    for (const node of wf.nodes) {
      if (node.type !== 'user_task') continue
      forms.push({
        workflow: wf.name,
        step: String(node.label),
        title: String(node.config?.task_title ?? node.label),
        outcomes: (node.config?.outcomes ?? []).map(String),
        fields: (node.config?.fields ?? []).filter((f: any) => !['heading', 'divider'].includes(f?.type)).map(field),
        kind: 'task',
        ...shape(node.config?.form_layout, node.config?.form_theme, node.config?.form_header, node.config?.form_buttons),
      })
    }
  }
  const listed: CatalogEntry['assets'] = []
  for (const [section, list] of Object.entries(assets)) {
    if (!Array.isArray(list)) continue
    for (const asset of list) {
      const detail = section === 'references' ? `${asset.request_config?.method ?? ''} ${asset.request_config?.path_template ?? ''}`.trim()
        : section === 'decision_tables' ? `${(asset.rules ?? []).length} rules`
        : section === 'workflows' ? `${(asset.nodes ?? []).length} steps`
        : undefined
      listed.push({ section, name: String(asset.name ?? ''), description: asset.description ?? null, ...(detail ? { detail } : {}) })
    }
  }
  const tables = (assets.data_tables ?? []).map((table: any) => ({
    id: String(table.id),
    name: String(table.name),
    columns: (table.columns ?? []).filter((c: any) => !['id', 'date_created'].includes(c.key)).map((c: any) => String(c.name ?? c.key)),
    rows: built.contents.data[String(table.id)]?.rows?.length ?? 0,
  }))
  const requirements: CatalogRequirement[] = built.contents.requirements.map((r) => ({
    id: r.id, kind: r.kind, label: r.label, description: r.description, required: r.required,
    fields: r.fields.map((f) => ({
      key: f.key, label: f.label, type: f.type, secret: f.secret,
      required: r.required && f.description !== 'Optional' && (r.kind === 'integration_auth' ? f.secret : r.kind === 'connector' ? f.secret && f.key.startsWith('credentials.') : true),
      ...(f.default !== undefined && !f.secret ? { default: f.default } : {}),
    })),
  }))
  const entryWorkflow = (assets.workflows ?? []).find((wf: any) => String(wf.id) === meta.entry_workflow)
  const { sample_input: sampleInput, expect: _expect, verify_mocks: _mocks, systems, ...rest } = meta
  return {
    ...rest,
    optional_needs: meta.optional_needs ?? [],
    systems: systems ?? [],
    native: isNativeContents(built.contents),
    released: releaseDate(source),
    file_name: built.fileName,
    checksum: built.manifest.checksum,
    sample_input: sampleInput ?? {},
    inputs: entryInputs(entryWorkflow, assets.forms ?? []),
    forms,
    workflows,
    assets: listed,
    tables,
    requirements,
    asset_count: built.assetCount,
  }
}
