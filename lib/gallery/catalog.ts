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

import type { ActionCatalogEntry } from './actions'
import { deriveInputFields } from '@/lib/workflow-inputs'
import type { BuiltGalleryPackage } from './build'
import { isNativeContents, releaseDate } from './build'
import type { GallerySource } from './source'
import type { ControlGalleryMeta, GalleryChangelogEntry, GalleryControlKind, GalleryMeta } from './types'
import type { ControlAccessibilitySpec, ControlContextSpec, ControlDisplaySpec, ControlOutputSpec, ControlPropSpec, ControlSizeSpec, ControlValueSpec } from '@/lib/forms/custom-controls/contract'

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
  /** Form features it showcases ("Steps & progress bar", "Application mode", "Data table", "Form rules"…). */
  uses?: string[]
}

/** The form features a stored form uses, as short labels for the gallery's "Uses" chips. */
export function formUses(fields: any[], layout: any): string[] {
  const list = Array.isArray(fields) ? fields : []
  const out: string[] = []
  if (layout?.mode === 'steps') out.push(layout?.page_settings?.indicator === 'progress' ? 'Steps & progress bar' : 'Steps')
  if (layout?.mode === 'tabs') out.push('Tabs')
  if (layout?.application_mode === true) out.push('Application mode')
  if (list.some((f) => f?.type === 'button')) out.push('In-form buttons')
  if (list.some((f) => f?.type === 'data_table')) out.push('Data table')
  if (Array.isArray(layout?.rules) && layout.rules.length) out.push('Form rules')
  if (list.some((f) => f?.type === 'lookup' && f?.lookup?.label_template)) out.push('Autocomplete labels')
  if (layout?.submitted_page?.enabled === true) out.push('Submitted page')
  return out
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
  /** Official form controls its forms use (they ship in the package): /gallery/controls/<slug>. */
  controls: Array<{ slug: string; tag: string; name: string }>
}

/** One form control in a control entry (from its validated manifest and module). */
export interface ControlCatalogItem {
  /** Source folder (gallery/controls/<slug>). */
  slug: string
  tag: string
  name: string
  version: string
  description: string | null
  icon: string | null
  kind: GalleryControlKind
  value: ControlValueSpec
  props: ControlPropSpec[]
  context: ControlContextSpec[]
  capabilities: string[]
  hosts: string[]
  display: ControlDisplaySpec | null
  /** What the workflow receives (absent in catalogs built before outputs). */
  output?: ControlOutputSpec | null
  accessibility: ControlAccessibilitySpec | null
  size: ControlSizeSpec
  validation: { reports_validity?: boolean }
  libraries: Array<{ name: string; version: string; licence: string }>
  module_bytes: number
  sha256: string
}

/** A form control (or a bundle of them) as the /gallery/controls pages show it. */
export interface ControlCatalogEntry {
  kind: 'form_control' | 'control_bundle'
  id: string
  /** Page slug: /gallery/controls/<slug>. */
  slug: string
  /** Package slug (index.json, file name): form-control-<slug> / form-controls-<slug>. */
  package_slug: string
  title: string
  control_kind: GalleryControlKind | null
  summary: string
  description: string
  icon: string | null
  tags: string[]
  version: string
  changelog: GalleryChangelogEntry[]
  released: string
  uses: string[]
  setup: string[]
  systems: string[]
  preview: ControlGalleryMeta['preview'] | null
  readme: string
  file_name: string
  checksum: string
  asset_count: number
  controls: ControlCatalogItem[]
  /** Config-as-code assets that ship with the control (integration, API reference, sample form). */
  extras: Array<{ section: string; name: string; description: string | null }>
  requirements: CatalogRequirement[]
}

export interface GalleryCatalog {
  format_version: 1
  packages: CatalogEntry[]
  /** Official form controls and control bundles (gallery/controls). */
  controls?: ControlCatalogEntry[]
  /** Official custom workflow actions (gallery/actions). */
  actions?: ActionCatalogEntry[]
}

const SECTION_LABEL: Record<string, string> = {
  workflows: 'Workflow', decision_tables: 'Decision table', data_tables: 'Data table', integrations: 'Integration',
  references: 'API reference', email_templates: 'Email template', agents: 'AI agent', workflow_activities: 'Workflow action',
  reports: 'Report', roles: 'Role', retention_policies: 'Retention policy', objects: 'Object',
  forms: 'Form', form_themes: 'Form theme', form_controls: 'Form control',
}

export function sectionLabel(section: string): string {
  return SECTION_LABEL[section] ?? section
}

function field(raw: any): CatalogField {
  // A Data table field previews its visible columns.
  const columns = raw?.type === 'data_table' && Array.isArray(raw?.data_table?.columns) ? raw.data_table.columns.filter((c: any) => !c?.hidden).map((c: any) => c?.label ?? c?.key) : null
  const options = Array.isArray(columns ?? raw?.options) ? (columns ?? raw.options).map((o: any) => String(typeof o === 'object' ? o?.label ?? o?.value : o)).filter(Boolean) : undefined
  return {
    key: String(raw?.key ?? raw?.name ?? ''),
    label: String(raw?.label ?? raw?.name ?? raw?.key ?? ''),
    // A custom control shows its element tag (ut-rating) rather than "custom".
    type: raw?.type === 'custom' && typeof raw?.custom?.tag === 'string' ? raw.custom.tag : String(raw?.type ?? 'text'),
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
  const shape = (layout: any, theme: any, header: any, buttons: any, fields: any[] = []) => {
    const rows = [...((layout?.rows ?? []) as any[]), ...((Array.isArray(layout?.pages) ? layout.pages : []) as any[]).flatMap((p) => (Array.isArray(p?.rows) ? p.rows : []))]
    const columns = Math.max(1, ...rows.map((row) => Number(row?.columns) || 1))
    const themed = Boolean((theme && theme.source && theme.source !== 'workspace') || header?.enabled)
    // Application mode hides the bar: the buttons people see are the in-form ones.
    const labels = layout?.application_mode === true
      ? (Array.isArray(fields) ? fields : []).filter((f: any) => f?.type === 'button').map((f: any) => String(f?.label ?? '')).filter(Boolean).filter((l, i, all) => all.indexOf(l) === i)
      : Array.isArray(buttons) && buttons.length ? buttons.filter((b: any) => !b?.hidden).map((b: any) => String(b?.label ?? '')).filter(Boolean) : undefined
    const uses = formUses(fields, layout)
    return { ...(columns > 1 ? { columns } : {}), ...(themed ? { themed } : {}), ...(labels?.length ? { buttons: labels } : {}), ...(uses.length ? { uses } : {}) }
  }
  const shown = (fields: any) => (Array.isArray(fields) ? fields : []).filter((f: any) => !['heading', 'divider', 'button', 'display_image'].includes(f?.type)).map(field)
  for (const form of assets.forms ?? []) {
    forms.push({
      workflow: 'Form page', step: String(form.name), title: String(form.header?.title || form.name), outcomes: [],
      fields: shown(form.fields), kind: 'page',
      ...shape(form.layout, form.theme, form.header, form.buttons, form.fields),
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
        fields: shown(node.config?.fields),
        kind: 'task',
        ...shape(node.config?.form_layout, node.config?.form_theme, node.config?.form_header, node.config?.form_buttons, node.config?.fields),
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
    controls: source.controls ?? [],
  }
}
