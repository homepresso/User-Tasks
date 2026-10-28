/**
 * Validation of gallery package sources: gallery.json, the asset envelopes,
 * every workflow (node config validation, graph, branch labels, references
 * resolve inside the package), decision tables, data tables and rows,
 * integrations (placeholder hosts only, no secrets) and requirements.
 * Pure apart from the source it is given; used by the build and the tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { NODE_CATALOG, type WorkflowNode } from '@/lib/workflow-schema'
import { validateWorkflow } from '@/lib/workflow-validation'
import { getBranchLabels } from '@/lib/workflow-branches'
import { normalizeScheduleConfig } from '@/lib/workflow-schedule'
import { isSemver } from '@/lib/packages/semver'
import { normalizeOperator } from '@/lib/conditions'
import { PACKAGE_SECTIONS } from '@/lib/packages/build'
import { scanAssetReferences } from '@/lib/portability/dependencies'
import { isUuid } from '@/lib/portability/plan'
import { scrubSecretsForExport, SECRET_PLACEHOLDER } from '@/lib/portability/scrub'
import { fieldDefinitionProblems, valueFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { normalizeFormDefinition, readNodeForm } from '@/lib/forms/definition'
import { buttonProblems } from '@/lib/forms/buttons'
import { FormThemeRefSchema } from '@/lib/forms/form-theme'
import { LOOKUP_ROW_ID } from '@/lib/forms/lookup'
import { buildGalleryPackage, galleryRequirements, packageAssets } from './build'
import type { GallerySource } from './source'
import { GALLERY_CATEGORIES, GALLERY_NEEDS, GALLERY_TRIGGERS, type GalleryMeta } from './types'

const TRIGGER_NODE_TYPES = new Set<string>(NODE_CATALOG.filter((n) => n.category === 'trigger').map((n) => n.type))

/** Trigger node types allowed for each gallery trigger kind. */
export const TRIGGER_NODES_BY_KIND: Record<GalleryMeta['trigger'], string[]> = {
  form: ['webhook_received', 'form_submitted'],
  api: ['webhook_received', 'middleware_received'],
  schedule: ['schedule'],
  event: ['data_table_event', 'form_submitted', 'task_created', 'task_completed', 'task_updated', 'task_submitted', 'task_received', 'workflow_sla', 'workflow_error'],
}

/** Nodes a gallery workflow must not use: placeholders are not real steps; raw HTTP bypasses the adaptable integration/reference model. */
const FORBIDDEN_NODES = new Set(['placeholder', 'http_request'])

/** Hosts allowed in shipped integrations: reserved example domains only (RFC 2606). */
const PLACEHOLDER_HOST = /(^|\.)example(\.(com|org|net))?$/i

const SECTION_OF_TYPE: Record<string, string> = {
  workflow: 'workflows', workflow_activity: 'workflow_activities', data_table: 'data_tables', integration: 'integrations',
  connector: 'connectors', decision_table: 'decision_tables', email_template: 'email_templates', agent: 'agents', report: 'reports',
  role: 'roles', mcp_server: 'mcp_servers', retention_policy: 'retention_policies', log_destination: 'log_destinations', reference: 'references',
  form: 'forms', form_theme: 'form_themes',
}

/**
 * Operators the engine's Condition node evaluates (lib/workflow-engine.ts
 * evaluateRule, after normalizeOperator). Anything else silently reads as
 * "no match" there, so gallery workflows may not use it.
 */
const ENGINE_CONDITION_OPERATORS = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty', 'is_true', 'is_false', 'starts_with', 'ends_with', 'in', 'matches'])

/** Operators the decision-table engine evaluates (lib/decision-table-engine.ts). A rule with no conditions is a catch-all there. */
const DECISION_OPERATORS = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'is_empty', 'is_not_empty'])

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface GalleryIssue {
  path: string
  message: string
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function validateMeta(meta: GalleryMeta, slug: string): GalleryIssue[] {
  const issues: GalleryIssue[] = []
  const at = `${slug}/gallery.json`
  const need = (cond: unknown, message: string) => { if (!cond) issues.push({ path: at, message }) }
  need(isUuid(meta.id), 'id must be a uuid')
  need(meta.slug === slug, `slug "${meta.slug}" must match the folder name "${slug}"`)
  need(SLUG.test(String(meta.slug ?? '')), 'slug must be lowercase words separated by hyphens')
  need(typeof meta.title === 'string' && meta.title.trim().length >= 3, 'title is required')
  need(GALLERY_CATEGORIES.some((c) => c.id === meta.category), `category must be one of ${GALLERY_CATEGORIES.map((c) => c.id).join(', ')}`)
  need(typeof meta.summary === 'string' && meta.summary.length >= 40 && meta.summary.length <= 200, 'summary must be 40-200 characters')
  need(typeof meta.description === 'string' && meta.description.length >= 200, 'description must be at least 200 characters')
  need(Object.keys(GALLERY_TRIGGERS).includes(meta.trigger), 'trigger must be form, api, schedule or event')
  need(isUuid(meta.entry_workflow), 'entry_workflow must be the id of a workflow in the package')
  need(typeof meta.start === 'string' && meta.start.length >= 20, 'start (how the process starts) is required')
  need(['starter', 'intermediate', 'advanced'].includes(meta.difficulty), 'difficulty must be starter, intermediate or advanced')
  need(Number.isInteger(meta.setup_minutes) && meta.setup_minutes > 0 && meta.setup_minutes <= 240, 'setup_minutes must be a whole number of minutes')
  need(Array.isArray(meta.tags) && meta.tags.length >= 2 && meta.tags.every((t) => typeof t === 'string' && t.trim()), 'at least two tags')
  need(isSemver(String(meta.version ?? '')), 'version must be semver')
  need(Array.isArray(meta.changelog) && meta.changelog.some((c) => c.version === meta.version), 'changelog must have an entry for the current version')
  for (const entry of meta.changelog ?? []) {
    need(isSemver(String(entry.version ?? '')) && DATE.test(String(entry.date ?? '')) && String(entry.notes ?? '').trim(), `changelog entry ${entry.version}: version, date (YYYY-MM-DD) and notes are required`)
  }
  need(Array.isArray(meta.needs), 'needs must be an array')
  for (const key of [...(meta.needs ?? []), ...(meta.optional_needs ?? [])]) need(key in GALLERY_NEEDS, `unknown need "${key}" (expected ${Object.keys(GALLERY_NEEDS).join(', ')})`)
  need(Array.isArray(meta.setup) && meta.setup.length >= 1, 'setup steps are required')
  need(Array.isArray(meta.steps) && meta.steps.length >= 3 && meta.steps.every((s) => s?.title && s?.body), 'at least three flow steps with title and body')
  need(meta.sample_input && typeof meta.sample_input === 'object' && !Array.isArray(meta.sample_input), 'sample_input must be an object')
  need(meta.expect === 'waiting' || meta.expect === 'completed', 'expect must be waiting or completed')
  if (meta.systems !== undefined) {
    need(Array.isArray(meta.systems) && meta.systems.length <= 6 && meta.systems.every((s) => typeof s === 'string' && s.trim().length >= 2 && s.length <= 40), 'systems must be up to six system names (2-40 characters)')
  }
  return issues
}

/**
 * A form (reusable form or a node's own form): field definitions, lookups
 * against data tables in the package (columns exist), buttons (outcome
 * buttons match the step's outcomes, redirects are app paths).
 */
export function formIssues(def: ReturnType<typeof normalizeFormDefinition>, tablesById: Map<string, any>, path: string, outcomes: string[] | null = null): GalleryIssue[] {
  const issues: GalleryIssue[] = []
  for (const [key, message] of Object.entries(fieldDefinitionProblems(def.fields))) issues.push({ path, message: `field "${key}": ${message}` })
  for (const field of def.fields as TaskFieldDef[]) {
    if (field.type === 'lookup' && field.lookup?.source === 'table') {
      const table = tablesById.get(String(field.lookup.table_id))
      if (!table) { issues.push({ path, message: `lookup "${field.key}": data table ${field.lookup.table_id} is not in the package` }); continue }
      const columns = new Set<string>([LOOKUP_ROW_ID, ...(table.columns ?? []).map((col: any) => String(col.key))])
      const used = [...(field.lookup.search_columns ?? []), ...(field.lookup.display_columns ?? []), ...(field.lookup.value_column ? [field.lookup.value_column] : []), ...(field.lookup.fill ?? []).map((f) => f.from), ...(field.lookup.filters ?? []).map((f) => f.column)]
      for (const column of used) if (!columns.has(column)) issues.push({ path, message: `lookup "${field.key}": column "${column}" is not in "${table.name}"` })
    }
    if (field.options_source && !tablesById.has(String(field.options_source.table_id))) issues.push({ path, message: `field "${field.key}": options table ${field.options_source.table_id} is not in the package` })
  }
  for (const [id, message] of Object.entries(buttonProblems(def.buttons ?? [], { outcomes, policy: { appOrigin: null, allowedHosts: [] } }))) issues.push({ path, message: `button "${id}": ${message}` })
  return issues
}

function validateWorkflowAsset(wf: any, ids: Map<string, Set<string>>, refsById: Map<string, any>, tablesById: Map<string, any>, decisionById: Map<string, any>, path: string): GalleryIssue[] {
  const issues: GalleryIssue[] = []
  const add = (message: string) => issues.push({ path, message })
  const nodes: WorkflowNode[] = Array.isArray(wf.nodes) ? wf.nodes : []
  const edges: any[] = Array.isArray(wf.edges) ? wf.edges : []
  if (!nodes.length) add('workflow has no nodes')
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (!node?.id || nodeIds.has(node.id)) add(`node id "${node?.id}" is missing or duplicated`)
    nodeIds.add(node.id)
    if (!NODE_CATALOG.some((entry) => entry.type === node.type)) add(`node "${node.id}" has unknown type "${node.type}"`)
    if (FORBIDDEN_NODES.has(node.type)) add(`node "${node.label}" (${node.type}) is not allowed in gallery workflows`)
    if (!node.label?.trim()) add(`node "${node.id}" needs a label`)
    if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') add(`node "${node.id}" needs a position`)
  }
  const triggers = nodes.filter((n) => TRIGGER_NODE_TYPES.has(n.type))
  if (triggers.length !== 1) add(`a workflow needs exactly one trigger node (found ${triggers.length})`)
  else if (triggers[0].type !== wf.trigger_type) add(`trigger_type "${wf.trigger_type}" does not match the trigger node "${triggers[0].type}"`)
  if (wf.trigger_type === 'schedule' && triggers[0] && !normalizeScheduleConfig(triggers[0].config ?? {})) add('schedule trigger is not configured')
  if (wf.is_active !== true) add('is_active must be true (installs publish and activate it)')

  const result = validateWorkflow(nodes, wf.trigger_type)
  for (const nodeError of result.nodeErrors) add(`node "${nodeError.nodeLabel}": ${nodeError.errors.join('; ')}`)

  // Edges, branch labels, reachability.
  const outgoing = new Map<string, any[]>()
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) add(`edge "${edge.id}" connects unknown nodes ${edge.source} → ${edge.target}`)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
  }
  for (const node of nodes) {
    const labels = getBranchLabels(node)
    const out = outgoing.get(node.id) ?? []
    if (labels.length) {
      for (const edge of out) {
        if (!labels.some((label) => label.toLowerCase() === String(edge.label ?? '').toLowerCase())) add(`edge from "${node.label}" has label "${edge.label ?? ''}", expected one of ${labels.join(', ')}`)
      }
      if (node.type === 'user_task' || node.type === 'condition' || node.type === 'switch_case') {
        for (const label of labels) if (!out.some((edge) => String(edge.label ?? '').toLowerCase() === label.toLowerCase())) add(`"${node.label}" has no path for "${label}"`)
      }
    }
  }
  const reachable = new Set<string>()
  const queue = triggers.map((t) => t.id)
  while (queue.length) {
    const id = queue.shift()!
    if (reachable.has(id)) continue
    reachable.add(id)
    for (const edge of outgoing.get(id) ?? []) queue.push(edge.target)
    const node = nodes.find((n) => n.id === id)
    if (node?.type === 'goto_activity' && node.config?.target_node_id) queue.push(String(node.config.target_node_id))
  }
  for (const node of nodes) if (!reachable.has(node.id) && node.type !== 'section_group') add(`node "${node.label}" is not reachable from the trigger`)

  // Cross-asset checks per node.
  for (const node of nodes) {
    const c = node.config ?? {}
    if (node.type === 'condition') {
      for (const branch of c.branches ?? []) {
        for (const rule of branch?.rules ?? []) {
          const op = normalizeOperator(String(rule?.operator ?? '').toLowerCase().trim())
          if (!ENGINE_CONDITION_OPERATORS.has(op)) add(`"${node.label}": operator "${rule?.operator}" is not evaluated by the Condition node`)
        }
      }
    }
    if (node.type === 'call_reference' || node.type === 'live_reference') {
      const reference = refsById.get(String(c.reference_id))
      if (!reference) { add(`"${node.label}": reference ${c.reference_id} is not in the package`); continue }
      for (const input of reference.inputs ?? []) {
        if (input.required && !String(c.input_mappings?.[input.name] ?? '').trim()) add(`"${node.label}": required reference input "${input.name}" is not mapped`)
      }
      const outputs = new Set((reference.outputs ?? []).map((o: any) => o.name))
      for (const key of Object.keys(c.output_mappings ?? {})) if (!outputs.has(key)) add(`"${node.label}": output mapping "${key}" is not an output of "${reference.name}"`)
    }
    if (node.type === 'decision_table') {
      const table = decisionById.get(String(c.decision_table_id))
      if (!table) { add(`"${node.label}": decision table ${c.decision_table_id} is not in the package`); continue }
      for (const input of table.inputs ?? []) if (!String(c.input_mappings?.[input.key] ?? '').trim()) add(`"${node.label}": decision input "${input.key}" is not mapped`)
    }
    if (node.type === 'update_data_table' || (node.type === 'data_table_event' && c.table_id)) {
      if (node.type === 'update_data_table' && c.match_column && !tablesById.get(String(c.table_id))?.columns?.some((col: any) => col.key === c.match_column)) add(`"${node.label}": match_column "${c.match_column}" is not a column`)
      const table = tablesById.get(String(c.table_id))
      if (!table) { add(`"${node.label}": data table ${c.table_id} is not in the package`); continue }
      const columns = new Set((table.columns ?? []).map((col: any) => col.key))
      for (const key of Object.keys(c.column_values ?? {})) if (!columns.has(key)) add(`"${node.label}": column "${key}" is not in "${table.name}"`)
    }
    if (['doc_word', 'doc_excel', 'doc_powerpoint'].includes(node.type)) {
      // `find` is literal ({{PLACEHOLDER}} is fine); an empty one is skipped at run time.
      for (const r of c.replacements ?? []) if (String(r?.replace ?? '').trim() && !String(r?.find ?? '').trim()) add(`"${node.label}": a replacement has an empty find`)
    }
    if (node.type === 'send_email' && c.email_template_id && !ids.get('email_templates')?.has(String(c.email_template_id))) add(`"${node.label}": email template is not in the package`)
    if (node.type === 'call_sub_workflow' && !ids.get('workflows')?.has(String(c.sub_workflow_id))) add(`"${node.label}": sub-workflow is not in the package`)
    if (node.type === 'run_agent' && !ids.get('agents')?.has(String(c.agent_id))) add(`"${node.label}": agent is not in the package`)
    if (node.type === 'user_task' && (c.assignment_type ?? 'individual') === 'individual' && !isUuid(c.assignee_id) && !String(c.assignee_variable ?? '').trim()) {
      add(`"${node.label}": give the step a placeholder assignee_id (uuid) so installs ask who receives it, or an assignee_variable (a Person field, {{submitted_by}}, {{workflow_started_by}} for whoever started the run, {{workflow_owner_id}} for the person who set the package up)`)
    }
    if (node.type === 'user_task' || node.type === 'form_submitted' || node.type.startsWith('task_')) {
      if (Array.isArray(c.fields) && c.fields.length) {
        const outcomes = node.type === 'user_task' ? (c.outcomes ?? []).map(String) : null
        issues.push(...formIssues(readNodeForm(c), tablesById, `${path} (${node.label})`, outcomes))
        if (c.form_theme !== undefined && !FormThemeRefSchema.safeParse(c.form_theme).success) add(`"${node.label}": form_theme is not a valid theme reference`)
      }
    }
    if (TRIGGER_NODE_TYPES.has(node.type) && c.start_form?.theme !== undefined && !FormThemeRefSchema.safeParse(c.start_form.theme).success) add(`"${node.label}": start_form.theme is not a valid theme reference`)
    if (node.type === 'form_submitted' && !ids.get('forms')?.has(String(c.form_id))) add(`"${node.label}": the Form submitted trigger must name a form in the package (form_id)`)
  }
  return issues
}

/** Every issue in one package source (empty = valid). Also builds it (unsigned) to run the packaging checks. */
export function validateGallerySource(source: GallerySource, options: { community?: boolean } = {}): GalleryIssue[] {
  const { slug, meta, manifest } = source
  const issues: GalleryIssue[] = [...source.errors.map((e) => ({ path: e.path, message: e.error }))]
  // Community packages have no gallery.json: their listing is checked by the submission service.
  if (!options.community) issues.push(...validateMeta(meta, slug))
  const assets = packageAssets(manifest)

  const allowed = new Set<string>([...PACKAGE_SECTIONS, 'table_rows', 'format_version'])
  for (const key of Object.keys(manifest)) if (!allowed.has(key)) issues.push({ path: `${slug}/assets`, message: `section "${key}" cannot travel in a package` })
  if (manifest.connectors?.length) issues.push({ path: `${slug}/assets`, message: 'gallery packages use integrations (REST) rather than connectors' })

  // Ids: uuids, unique across the package.
  const ids = new Map<string, Set<string>>()
  const seen = new Set<string>()
  for (const section of PACKAGE_SECTIONS) {
    for (const [index, asset] of (assets[section] ?? []).entries()) {
      const path = `${slug}/assets/${source.paths[section]?.[index] ?? section}`
      if (!isUuid(asset?.id)) issues.push({ path, message: `id "${asset?.id}" must be a uuid` })
      if (seen.has(String(asset?.id))) issues.push({ path, message: `id ${asset?.id} is used twice` })
      seen.add(String(asset?.id))
      if (!String(asset?.name ?? '').trim()) issues.push({ path, message: 'name is required' })
      ;(ids.get(section) ?? ids.set(section, new Set()).get(section)!).add(String(asset?.id))
    }
  }

  // Sources are already scrubbed: what the build would scrub must equal what is there.
  if (!deepEqual(scrubSecretsForExport(assets), assets)) issues.push({ path: `${slug}/assets`, message: `a value under a credential-shaped key is not "${SECRET_PLACEHOLDER}" (sources must not contain secrets)` })

  // Every id an asset points at resolves inside the package.
  for (const section of PACKAGE_SECTIONS) {
    for (const [index, asset] of (assets[section] ?? []).entries()) {
      const path = `${slug}/assets/${source.paths[section]?.[index] ?? section}`
      for (const ref of scanAssetReferences(asset).refs) {
        const target = SECTION_OF_TYPE[ref.type]
        if (target && !ids.get(target)?.has(ref.id) && ref.id !== String(asset.id)) {
          issues.push({ path, message: `${ref.path.join('.')} points at ${ref.type} ${ref.id}, which is not in the package` })
        }
      }
    }
  }

  const refsById = new Map<string, any>((assets.references ?? []).map((r: any) => [String(r.id), r]))
  const tablesById = new Map<string, any>((assets.data_tables ?? []).map((t: any) => [String(t.id), t]))
  const decisionById = new Map<string, any>((assets.decision_tables ?? []).map((t: any) => [String(t.id), t]))
  const formsById = new Map<string, any>((assets.forms ?? []).map((f: any) => [String(f.id), f]))

  // Reusable forms: fields, lookups, buttons, theme.
  for (const [index, form] of (assets.forms ?? []).entries()) {
    const path = `${slug}/assets/${source.paths.forms?.[index] ?? 'forms'}`
    if (!Array.isArray(form.fields) || !form.fields.length) { issues.push({ path, message: 'a form needs at least one field' }); continue }
    if (form.theme !== undefined && form.theme !== null && !FormThemeRefSchema.safeParse(form.theme).success) issues.push({ path, message: 'theme is not a valid theme reference' })
    issues.push(...formIssues(normalizeFormDefinition(form), tablesById, path))
  }

  for (const [index, wf] of (assets.workflows ?? []).entries()) {
    issues.push(...validateWorkflowAsset(wf, ids, refsById, tablesById, decisionById, `${slug}/assets/${source.paths.workflows?.[index] ?? 'workflows'}`))
  }
  const entry = (assets.workflows ?? []).find((wf: any) => wf.id === meta.entry_workflow)
  if (!entry) issues.push({ path: `${slug}/gallery.json`, message: 'entry_workflow is not a workflow in the package' })
  else {
    const allowedTriggers = TRIGGER_NODES_BY_KIND[meta.trigger] ?? []
    if (!allowedTriggers.includes(entry.trigger_type)) issues.push({ path: `${slug}/gallery.json`, message: `trigger "${meta.trigger}" needs an entry workflow triggered by ${allowedTriggers.join(' / ')} (found ${entry.trigger_type})` })
    if (meta.entry_form !== undefined && !formsById.has(String(meta.entry_form))) issues.push({ path: `${slug}/gallery.json`, message: 'entry_form must be a form in the package' })
    const formTrigger = entry.trigger_type === 'form_submitted' ? (entry.nodes ?? []).find((n: any) => n.type === 'form_submitted') : null
    const startForm = formTrigger ? formsById.get(String(formTrigger.config?.form_id)) : null
    if (meta.trigger === 'form' && !formTrigger && !(entry.nodes ?? []).some((n: any) => n.type === 'user_task' && Array.isArray(n.config?.fields) && n.config.fields.length)) {
      issues.push({ path: `${slug}/gallery.json`, message: 'a form-started package needs a User Task with form fields in its entry workflow' })
    }
    // A Form submitted entry starts from the form's fields; a start-form / API entry from its workflow variables.
    const vars = startForm
      ? new Map<string, any>(valueFields(normalizeFormDefinition(startForm).fields).map((f) => [f.key, { name: f.key, required: f.required === true, description: f.label }]))
      : new Map<string, any>((entry.user_variables ?? []).map((v: any) => [String(v.name), v]))
    if (!startForm && !options.community && (meta.trigger === 'form' || meta.trigger === 'api')) {
      if (!vars.size) issues.push({ path: `${slug}/gallery.json`, message: 'form and API packages declare their start inputs as workflow variables' })
      for (const v of vars.values()) if (!String(v.description ?? '').trim()) issues.push({ path: `${slug}/gallery.json`, message: `workflow input "${v.name}" needs a description (it is the start form's help text)` })
    }
    const checkSample = !options.community || Object.keys(meta.sample_input ?? {}).length > 0
    if (checkSample) for (const key of Object.keys(meta.sample_input ?? {})) if (vars.size && !vars.has(key)) issues.push({ path: `${slug}/gallery.json`, message: `sample_input.${key} is not a workflow input of the entry workflow` })
    if (checkSample) for (const v of vars.values()) if (v.required && (meta.sample_input as any)?.[v.name] === undefined) issues.push({ path: `${slug}/gallery.json`, message: `sample_input is missing the required input "${v.name}"` })
  }

  // References: an integration in the package, response models for the data picker.
  for (const [index, reference] of (assets.references ?? []).entries()) {
    const path = `${slug}/assets/${source.paths.references?.[index] ?? 'references'}`
    if (!ids.get('integrations')?.has(String(reference.integration_id))) issues.push({ path, message: 'integration_id is not an integration in the package' })
    if (!reference.request_config?.method || reference.request_config?.path_template === undefined) issues.push({ path, message: 'request_config needs method and path_template' })
    if ((reference.outputs ?? []).length && !reference.request_config?.response_schema?.root) issues.push({ path, message: 'add request_config.response_schema (the response model the data picker shows)' })
    const names = new Set<string>()
    for (const input of reference.inputs ?? []) {
      if (!input?.name || names.has(input.name)) issues.push({ path, message: `input "${input?.name}" is missing or duplicated` })
      names.add(input?.name)
    }
  }

  // Integrations: placeholder hosts only; credentials are the sentinel.
  for (const [index, integration] of (assets.integrations ?? []).entries()) {
    const path = `${slug}/assets/${source.paths.integrations?.[index] ?? 'integrations'}`
    const baseUrl = String(integration.config?.base_url ?? '')
    try {
      const host = new URL(baseUrl).hostname
      if (!PLACEHOLDER_HOST.test(host)) issues.push({ path, message: `base_url host "${host}" must be a placeholder (*.example.com) — installs set the real one` })
    } catch {
      issues.push({ path, message: 'base_url must be an absolute URL' })
    }
  }

  // Decision tables: rules use declared inputs and outputs.
  for (const [index, table] of (assets.decision_tables ?? []).entries()) {
    const path = `${slug}/assets/${source.paths.decision_tables?.[index] ?? 'decision_tables'}`
    const inputs = new Set((table.inputs ?? []).map((i: any) => i.key))
    const outputs = new Set((table.outputs ?? []).map((o: any) => o.key))
    if (!inputs.size || !outputs.size || !(table.rules ?? []).length) issues.push({ path, message: 'a decision table needs inputs, outputs and rules' })
    const enabledRules = (table.rules ?? []).filter((rule: any) => rule?.enabled !== false)
    for (const rule of table.rules ?? []) {
      // A rule with no conditions is a catch-all; anything after it never runs.
      if (rule?.enabled !== false && !(rule.conditions ?? []).length && enabledRules.indexOf(rule) < enabledRules.length - 1) {
        issues.push({ path, message: `rule "${rule.label}" has no conditions, so it matches everything and the rules after it never run — move it last` })
      }
      for (const condition of rule.conditions ?? []) {
        if (!inputs.has(condition.inputKey)) issues.push({ path, message: `rule "${rule.label}" uses unknown input "${condition.inputKey}"` })
        if (!DECISION_OPERATORS.has(condition.operator)) issues.push({ path, message: `rule "${rule.label}" uses operator "${condition.operator}", which decision tables do not evaluate` })
      }
      for (const key of Object.keys(rule.outputs ?? {})) if (!outputs.has(key)) issues.push({ path, message: `rule "${rule.label}" sets unknown output "${key}"` })
    }
  }

  // Data tables and sample rows.
  const rowIds = new Set<string>()
  for (const entryRows of Array.isArray(manifest.table_rows) ? manifest.table_rows : []) {
    const table = tablesById.get(String(entryRows.id))
    const path = `${slug}/assets/data-rows`
    if (!table) { issues.push({ path, message: `rows for unknown table ${entryRows.id}` }); continue }
    const columns = new Set((table.columns ?? []).map((c: any) => c.key))
    for (const row of entryRows.rows ?? []) {
      if (!isUuid(row?.id) || rowIds.has(row.id)) issues.push({ path, message: `row id ${row?.id} must be a unique uuid` })
      rowIds.add(row?.id)
      for (const key of Object.keys(row?.data ?? {})) if (!columns.has(key)) issues.push({ path, message: `row ${row?.id}: "${key}" is not a column of "${table.name}"` })
    }
  }
  for (const [index, table] of (assets.data_tables ?? []).entries()) {
    const path = `${slug}/assets/${source.paths.data_tables?.[index] ?? 'data_tables'}`
    const keys = new Set<string>()
    for (const column of table.columns ?? []) {
      if (!column?.key || !column?.name || !column?.type || keys.has(column.key)) issues.push({ path, message: `column "${column?.key}" needs a unique key, a name and a type` })
      keys.add(column?.key)
    }
  }

  if (options.community) return issues
  // Requirements line up with the needs chips.
  const requirements = galleryRequirements(assets)
  const needs = new Set([...(meta.needs ?? []), ...(meta.optional_needs ?? [])])
  if (requirements.some((r) => r.kind === 'user') && !meta.needs?.includes('assignees')) issues.push({ path: `${slug}/gallery.json`, message: 'the package asks for assignees: add "assignees" to needs' })
  if ((assets.integrations ?? []).length && !needs.has('rest_api') && !needs.has('ai_model') && !needs.has('directory')) issues.push({ path: `${slug}/gallery.json`, message: 'the package has integrations: add "rest_api" (or ai_model / directory) to needs' })
  if ((assets.agents ?? []).length && !needs.has('ai_model')) issues.push({ path: `${slug}/gallery.json`, message: 'the package has an agent: add "ai_model" to needs' })
  const sendsEmail = (assets.workflows ?? []).some((wf: any) => (wf.nodes ?? []).some((n: any) => n.type === 'send_email'))
  if (sendsEmail && !needs.has('email')) issues.push({ path: `${slug}/gallery.json`, message: 'the package sends email: add "email" to needs or optional_needs' })

  if (!issues.length) {
    try {
      buildGalleryPackage(source)
    } catch (error) {
      issues.push({ path: slug, message: (error as Error).message })
    }
  }
  return issues
}
