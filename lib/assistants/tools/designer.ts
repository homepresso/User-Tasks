/**
 * Designer assistant tools: the MCP tool implementations, in-process (server
 * only). Each assistant tool is the MCP tool of the same name, bound to a
 * context for the signed-in person exactly like a user API key would be
 * (keyType 'user', their user id, their resolved permissions) — so the same
 * per-tool authorisation (lib/mcp/authz), service checks, audit and
 * governance apply. Nothing is re-implemented here.
 *
 *  - Only an allowlist of tools is exposed (types.ts DESIGNER_READ_TOOLS /
 *    DESIGNER_WRITE_TOOLS), and of those only the ones the person's
 *    permissions allow (requiredToolPermission) — the model never sees the
 *    rest. No delete, publish, toggle, run, row, secret or settings tool.
 *  - Write tools are mode 'write': the engine shows a confirmation card and
 *    runs them only after the person confirms.
 *  - Drafts only: arguments that would publish or activate are removed from
 *    the schema the model sees AND from the arguments before the call
 *    (workflows: is_active / publish; custom actions: status forced to
 *    'draft', no enable / host / data grants; form controls: module upload
 *    only, a new control is disabled right after it is created).
 */
import { getMcpToolCatalog, type McpContext, type McpToolServer } from '@/lib/mcp/server'
import { requiredToolPermission } from '@/lib/mcp/authz'
import { holdsPermission } from '@/lib/permissions'
import type { AssistantToolDef } from '../engine'
import { DESIGNER_READ_TOOLS, DESIGNER_WRITE_TOOLS } from '../types'
import { draftFromArgs, workflowWarnings } from '../workflow-check'
import { buildPlanTools, CREATE_TOOL } from './build-plan'
import { compactRead, COMPACT_READ_TOOLS, DETAIL_PARAM, NODE_IDS_PARAM } from './compact-reads'
import { ITEM_REFERENCE, NODE_REFERENCE_TOOL, nodeReferenceTool, referenceKindOf } from './node-reference'
import { themeChanges, themeChangesPreview, themeCheckError, themeReferenceTool } from './theme-reference'
import { hasAnimatedSuccessPage, withDefaultSuccessPage } from '@/lib/forms/success-defaults'

/* eslint-disable @typescript-eslint/no-explicit-any -- MCP payloads are JSON */

/** Arguments the model may never send, per tool (publish / activate / enable / grant / fetch-from-URL). */
export const FORBIDDEN_ARGS: Record<string, readonly string[]> = {
  workflows_create: ['is_active', 'publish', 'publish_notes'],
  workflows_update: ['is_active', 'publish', 'publish_notes'],
  workflow_activities_create: ['status'],
  workflow_activities_update: ['status', 'enabled', 'approved_hosts', 'data_grants'],
  form_controls_create: ['url', 'manifest_url', 'package_base64'],
  form_controls_update: ['enabled', 'approved_hosts'],
  agents_update: ['is_active'],
  email_templates_create: ['is_default'],
  email_templates_update: ['is_default'],
}

/** Arguments forced on, per tool (drafts). */
const FORCED_ARGS: Record<string, Record<string, unknown>> = {
  workflows_create: { is_active: false },
  workflow_activities_create: { status: 'draft' },
  // A new workflow agent starts inactive (an admin turns it on after testing it in the playground).
  agents_create: { is_active: false },
}

/** Remove what a write may not do, force drafts. */
export function draftOnlyArgs(tool: string, args: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...args }
  for (const key of FORBIDDEN_ARGS[tool] ?? []) delete out[key]
  Object.assign(out, FORCED_ARGS[tool] ?? {})
  // A new form ends on the animated thank-you page unless the layout says otherwise (shared with the wizard).
  if (tool === 'forms_create') out.layout = withDefaultSuccessPage(out.layout)
  if (tool === 'workflows_update' && out.definition && typeof out.definition === 'object') {
    const def = { ...out.definition }
    delete def.is_active
    delete def.publish
    out.definition = def
  }
  return out
}

/** The designer tools this person's permissions allow (names). */
export function allowedDesignerToolNames(permissions: ReadonlySet<string>): string[] {
  const has = (p: string | undefined) => Boolean(p) && holdsPermission(permissions, p!)
  return [...DESIGNER_READ_TOOLS, ...DESIGNER_WRITE_TOOLS].filter((name) => {
    if (!has(requiredToolPermission(name))) return false
    // A new control is disabled right after it is created: that needs edit too.
    if (name === 'form_controls_create') return has('extensibility.edit')
    return true
  })
}

const WRITE_SET = new Set<string>(DESIGNER_WRITE_TOOLS)

/** Parameter descriptions longer than this are shortened in the tool list (the full text: workflow_node_reference). */
export const PARAM_DESCRIPTION_MAX = 320
/** Tool descriptions longer than this are shortened the same way. */
export const TOOL_DESCRIPTION_MAX = 700

function shorten(text: string, max: number, kind: string): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 40)
  const at = Math.max(cut.lastIndexOf('; '), cut.lastIndexOf(', '), cut.lastIndexOf('. '))
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()} … (full reference: ${NODE_REFERENCE_TOOL} items ["${kind}"])`
}

/**
 * The tool list is resent on every call: long help texts (forms_create's
 * field / layout help alone is ~10k characters, twice with forms_update) are
 * shortened in it, with a pointer to workflow_node_reference, which returns
 * the full text for the item kind when the model is about to build one.
 */
export function trimSchema(schema: any, kind: string | null, max = PARAM_DESCRIPTION_MAX): any {
  if (!kind || !schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map((x) => trimSchema(x, kind, max))
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'description' && typeof v === 'string') out[k] = shorten(v, max, kind)
    else if (k === 'enum' || k === 'required') out[k] = v
    else out[k] = trimSchema(v, kind, max)
  }
  return out
}

/**
 * An update tool's array items take the same shape as its create tool's:
 * the item schemas are left out of the update tool (one copy in the tool
 * list, the create tool's; the full shape from workflow_node_reference).
 */
export function collapseUpdateItems(schema: any, createTool: string): any {
  if (!schema?.properties) return schema
  const props: Record<string, any> = {}
  for (const [k, v] of Object.entries<any>(schema.properties)) {
    props[k] = v?.type === 'array' && v.items && typeof v.items === 'object' && v.items.type === 'object' && v.items.properties
      ? { ...v, items: { type: 'object', description: `Same shape as ${k} in ${createTool}` } }
      : v
  }
  return { ...schema, properties: props }
}

/** The model-facing JSON Schema of an MCP tool, without the forbidden arguments. */
function schemaFor(name: string, inputSchema: any): Record<string, unknown> {
  const schema = JSON.parse(JSON.stringify(inputSchema ?? { type: 'object', properties: {} }))
  delete schema.$schema
  for (const key of FORBIDDEN_ARGS[name] ?? []) {
    if (schema.properties) delete schema.properties[key]
    if (Array.isArray(schema.required)) schema.required = schema.required.filter((r: string) => r !== key)
  }
  if (!schema.type) schema.type = 'object'
  if (!schema.properties) schema.properties = {}
  // Every list tool takes `query` (a name filter) for the Agent, whatever the MCP tool calls it.
  if (name.endsWith('_list') && !schema.properties.query) schema.properties.query = { type: 'string', description: 'Only items whose name contains this text' }
  // Reads summarise by default (compact-reads.ts); the full item on request.
  if (COMPACT_READ_TOOLS.has(name)) {
    schema.properties.detail = DETAIL_PARAM
    if (name.startsWith('workflows_get')) schema.properties.node_ids = NODE_IDS_PARAM
  }
  return schema
}

/** Arguments only the Agent's wrapper understands (removed before the MCP call). */
const WRAPPER_ARGS = ['detail', 'node_ids']

/** A list call's arguments for the MCP tool (`query` mapped to its own `search`, or applied afterwards). */
function listArgs(inputSchema: any, args: Record<string, any>): { args: Record<string, any>; filter: string | null } {
  const q = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : null
  const props = inputSchema?.properties ?? {}
  if (!q || props.query) return { args, filter: null }
  const rest = { ...args }
  delete rest.query
  if (props.search) return { args: { ...rest, search: q }, filter: null }
  return { args: rest, filter: q }
}

/** The JSON payload of an MCP result (or { error }). */
export function mcpPayload(result: any): any {
  const text = Array.isArray(result?.content) ? result.content.map((c: any) => (c?.type === 'text' ? c.text : '')).join('') : ''
  if (result?.isError) return { error: text.replace(/^Error:\s*/, '') || 'The tool failed' }
  try { return text ? JSON.parse(text) : {} } catch { return { result: text } }
}

const KIND: Record<string, { kind: string; noun: string }> = {
  workflows: { kind: 'workflow', noun: 'workflow' },
  forms: { kind: 'form', noun: 'form' },
  data: { kind: 'data_table', noun: 'data table' },
  decision: { kind: 'decision_table', noun: 'decision table' },
  workflow: { kind: 'workflow_activity', noun: 'custom action' },
  form_controls: { kind: 'form_control', noun: 'form control' },
}

function kindOf(tool: string) {
  if (tool.startsWith('data_rows')) return { kind: 'data_rows', noun: 'row' }
  if (tool.startsWith('reports')) return { kind: 'report', noun: 'report' }
  if (tool.startsWith('agents')) return { kind: 'agent', noun: 'agent' }
  if (tool.startsWith('email_templates')) return { kind: 'email_template', noun: 'email template' }
  if (tool.startsWith('integrations') || tool.startsWith('connectors')) return { kind: 'integration', noun: 'connection' }
  if (tool.startsWith('form_controls')) return KIND.form_controls
  if (tool.startsWith('workflow_activities')) return KIND.workflow
  if (tool.startsWith('workflows')) return KIND.workflows
  if (tool.startsWith('forms')) return KIND.forms
  if (tool.startsWith('data_tables')) return KIND.data
  return KIND.decision
}

export function hrefFor(kind: string, id: string | null): string | null {
  if (!id) return null
  switch (kind) {
    case 'workflow': return `/automations/${id}`
    case 'form': return `/automations/forms?open=${encodeURIComponent(id)}`
    case 'data_table': case 'data_rows': return `/data/${id}`
    case 'decision_table': return `/automations/rules/${id}`
    case 'workflow_activity': return `/extensibility?action=${encodeURIComponent(id)}`
    case 'form_control': return '/extensibility'
    case 'report': return `/reports/${id}`
    case 'agent': return `/agents/${id}`
    case 'email_template': return '/automations/email-templates'
    case 'integration': return `/integrations/${id}`
    default: return null
  }
}

/** The created / updated item's id and name from a write's payload. */
export function changedItem(tool: string, args: Record<string, any>, payload: any): { id: string | null; name: string | null } {
  const obj = payload?.report ?? payload?.agent ?? payload?.template ?? payload?.email_template ?? payload?.form ?? payload?.workflow ?? payload?.table ?? payload?.decision_table ?? payload?.workflow_activity ?? payload?.activity ?? payload?.form_control ?? payload?.control ?? payload
  const id = obj?.id ?? payload?.id ?? args.report_id ?? args.agent_id ?? args.template_id ?? args.form_id ?? args.workflow_id ?? args.table_id ?? args.decision_table_id ?? args.workflow_activity_id ?? args.form_control_id ?? payload?.table_id ?? null
  const name = obj?.name ?? args.name ?? null
  return { id: id ? String(id) : null, name: name ? String(name) : null }
}

const json = (v: unknown): any => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return undefined }
}
const list = (v: unknown): any[] => (Array.isArray(json(v)) ? json(v) : [])
const names = (items: any[], keyOf: (x: any) => string) => items.map(keyOf).filter(Boolean)
const quote = (xs: string[], max = 8) => xs.slice(0, max).map((x) => `“${x}”`).join(', ') + (xs.length > max ? ` and ${xs.length - max} more` : '')

/**
 * The confirmation card's lines: what a write creates or changes. For an
 * update the current item is read first (as the person) to show the
 * difference in fields / steps / columns / rules.
 */
async function describeWrite(tool: string, args: Record<string, any>, read: (name: string, a: Record<string, any>) => Promise<any>): Promise<{ title: string; lines: string[]; warnings: string[]; preview?: ReturnType<typeof themeChangesPreview> }> {
  const { noun } = kindOf(tool)
  const lines: string[] = []
  const warnings: string[] = []
  let preview: ReturnType<typeof themeChangesPreview> | undefined
  const creating = tool.endsWith('_create')
  let current: any = null
  let currentName: string | null = null
  if (!creating) {
    const getter: Record<string, [string, Record<string, any>]> = {
      workflows_update: ['workflows_get_definition', { workflow_id: args.workflow_id }],
      forms_update: ['forms_get', { form_id: args.form_id }],
      data_tables_update_schema: ['data_tables_get', { table_id: args.table_id }],
      decision_tables_update: ['decision_tables_get', { decision_table_id: args.decision_table_id }],
      workflow_activities_update: ['workflow_activities_get', { workflow_activity_id: args.workflow_activity_id }],
      reports_update: ['reports_get', { report_id: args.report_id }],
      agents_update: ['agents_get', { agent_id: args.agent_id }],
      email_templates_update: ['email_templates_get', { template_id: args.template_id ?? args.email_template_id }],
      form_controls_update: ['form_controls_get', { form_control_id: args.form_control_id }],
    }
    const g = getter[tool]
    if (g) {
      const payload = await read(g[0], g[1])
      if (payload?.error) throw new Error(`Can't find that ${noun}: ${payload.error}`)
      current = payload?.report ?? payload?.agent ?? payload?.template ?? payload?.email_template ?? payload?.form ?? payload?.definition ?? payload?.workflow ?? payload?.table ?? payload?.decision_table ?? payload?.workflow_activity ?? payload?.activity ?? payload?.form_control ?? payload
      currentName = current?.name ? String(current.name) : null
    }
  }
  const title = tool === 'integrations_test' ? 'Test the connection' : creating ? `Create ${noun} “${String(args.name ?? 'Untitled')}”` : `Update ${noun}${currentName ? ` “${currentName}”` : ''}`
  if (!creating && args.name && args.name !== currentName) lines.push(`Rename to “${args.name}”`)

  const diff = (label: string, before: string[], after: string[]) => {
    const added = after.filter((x) => !before.includes(x))
    const removed = before.filter((x) => !after.includes(x))
    if (added.length) lines.push(`Add ${label}: ${quote(added)}`)
    if (removed.length) { lines.push(`Remove ${label}: ${quote(removed)}`); warnings.push(`Removes ${removed.length} ${label}`) }
    if (!added.length && !removed.length && after.length) lines.push(`Change ${label} (${after.length} in total)`)
  }

  switch (tool) {
    case 'workflows_create':
    case 'workflows_update': {
      const def = json(args.definition) ?? {}
      const nodes = list(args.nodes).length ? list(args.nodes) : list(def.nodes)
      const nodeName = (n: any) => String(n?.label ?? n?.data?.label ?? n?.type ?? n?.id ?? '')
      if (creating) {
        if (args.trigger_type) lines.push(`Trigger: ${args.trigger_type}`)
        if (nodes.length) lines.push(`${nodes.length} step${nodes.length === 1 ? '' : 's'}: ${quote(names(nodes, nodeName))}`)
      } else if (nodes.length) {
        diff('steps', names(list(current?.nodes), nodeName), names(nodes, nodeName))
      }
      if (!creating && (args.trigger_type || def.trigger_type) && (args.trigger_type ?? def.trigger_type) !== current?.trigger_type) lines.push(`Change the trigger to ${args.trigger_type ?? def.trigger_type}`)
      lines.push(creating ? 'Saved as an inactive draft — nothing runs until you publish and turn it on' : 'Saved to the draft — runs keep using the published version until you publish')
      break
    }
    case 'forms_create':
    case 'forms_update': {
      const fieldName = (f: any) => String(f?.label ?? f?.key ?? '')
      if (args.fields !== undefined) {
        if (creating) lines.push(`${list(args.fields).length} field${list(args.fields).length === 1 ? '' : 's'}: ${quote(names(list(args.fields), fieldName))}`)
        else diff('fields', names(list(current?.fields), fieldName), names(list(args.fields), fieldName))
      }
      if (args.layout !== undefined && !creating) lines.push('Update the layout')
      if (creating) lines.push(hasAnimatedSuccessPage(json(args.layout)) ? 'Success page: animated thank-you (with the reference number)' : json(args.layout)?.submitted_page?.enabled === false ? 'No success page' : 'Success page: as set in the layout')
      if (args.buttons !== undefined) lines.push('Update the buttons')
      if (args.theme !== undefined) {
        // Theme: each changed setting before → after (colours get swatches on the card).
        const changes = themeChanges(creating ? { source: 'workspace' } : current?.theme ?? { source: 'workspace' }, json(args.theme), { form: true })
        const settings = changes.filter((c) => c.path !== 'theme')
        lines.push(changes.length ? `Theme: ${settings.length ? `${settings.length} setting${settings.length === 1 ? '' : 's'} (${quote(settings.map((c) => c.path), 6)})` : changes[0].after}` : 'Theme: no change')
        if (changes.length) preview = themeChangesPreview(changes)
      }
      if (!creating) warnings.push('Forms have no draft: people filling this form see the new version (published workflows stay on theirs)')
      break
    }
    case 'data_tables_create':
    case 'data_tables_update_schema': {
      const colName = (c: any) => String(c?.name ?? c?.key ?? '')
      if (creating) lines.push(`${list(args.columns).length} column${list(args.columns).length === 1 ? '' : 's'}: ${quote(names(list(args.columns), colName))}`)
      else diff('columns', names(list(current?.columns ?? current?.schema?.columns), colName), names(list(args.columns), colName))
      break
    }
    case 'decision_tables_create':
    case 'decision_tables_update': {
      if (args.inputs !== undefined) lines.push(`Inputs: ${quote(names(list(args.inputs), (x) => String(x?.label ?? x?.name ?? x?.key ?? '')))}`)
      if (args.outputs !== undefined) lines.push(`Outputs: ${quote(names(list(args.outputs), (x) => String(x?.label ?? x?.name ?? x?.key ?? '')))}`)
      if (args.rules !== undefined) lines.push(`${list(args.rules).length} rule${list(args.rules).length === 1 ? '' : 's'}${creating ? '' : ` (was ${list(current?.rules).length})`}`)
      if (!creating) warnings.push('Decision tables have no draft: workflows that call this table use the change at once')
      break
    }
    case 'workflow_activities_create':
    case 'workflow_activities_update':
      if (args.source_code !== undefined) lines.push(`${creating ? 'Code' : 'Replace the code'} (${String(args.source_code).split('\n').length} lines)`)
      if (args.manifest !== undefined) lines.push('Inputs and outputs (manifest)')
      if (creating) lines.push('Created as a draft for review')
      break
    case 'form_controls_create': {
      const manifest = json(args.manifest) ?? {}
      lines.push(`Control <${String(manifest.tag ?? '?')}> “${String(manifest.name ?? manifest.tag ?? 'Untitled')}”`)
      lines.push('Created disabled — an admin reviews and enables it in Extensibility')
      break
    }
    case 'form_controls_update':
      if (args.description !== undefined) lines.push('Update the description')
      break
    case 'reports_create':
    case 'reports_update': {
      const cfg = json(args.config) ?? {}
      if (cfg.source || cfg.data_source) lines.push(`Source: ${String(cfg.source ?? cfg.data_source)}`)
      if (Array.isArray(cfg.columns)) lines.push(`${cfg.columns.length} column${cfg.columns.length === 1 ? '' : 's'}`)
      if (Array.isArray(cfg.filters) && cfg.filters.length) lines.push(`${cfg.filters.length} filter${cfg.filters.length === 1 ? '' : 's'}`)
      if (cfg.group_by || cfg.groupBy) lines.push(`Grouped by ${String(cfg.group_by ?? cfg.groupBy)}`)
      const charts = list(cfg.charts)
      if (charts.length) {
        const before = names(list(json(current?.config)?.charts ?? current?.config?.charts), (c) => String(c?.title ?? c?.type ?? ''))
        const after = names(charts, (c) => String(c?.title ?? `${c?.type ?? 'chart'}${c?.x ? ` by ${c.x}` : ''}`))
        if (creating) lines.push(`Charts: ${quote(after)}`); else diff('charts', before, after)
      }
      if (args.is_shared === true) warnings.push('Shares the report with everyone who can see reports')
      break
    }
    case 'agents_create':
    case 'agents_update': {
      // Never grant access silently: every grant and powerful tool is listed on the card.
      if (args.system_prompt !== undefined || args.task !== undefined || args.role !== undefined) lines.push(`${creating ? 'Instructions' : 'New instructions'}: “${String(args.system_prompt ?? args.task ?? args.role ?? '').replace(/\s+/g, ' ').slice(0, 140)}${String(args.system_prompt ?? args.task ?? '').length > 140 ? '…' : ''}”`)
      if (args.model) lines.push(`Model: ${args.model}`)
      if (args.integration_id) lines.push('Uses the chosen AI provider connection')
      const tools = list(args.tools).map((t: any) => String(t?.name ?? t?.id ?? t))
      if (tools.length) lines.push(`Tools: ${quote(tools, 12)}`)
      const risky = tools.filter((t) => /http_|delete|complete_|redirect|escalate|start_workflow|respond_to_task|download/.test(t))
      if (risky.length) warnings.push(`Powerful tools: ${quote(risky, 12)} — the agent can act with them when it runs`)
      const oc = json(args.output_config) ?? {}
      const grants = list(oc?.data_access?.grants)
      if (grants.length) warnings.push(`Data access: ${grants.map((g: any) => `${['read', 'insert', 'update', 'delete'].filter((k) => g?.[k]).join('/') || 'no operations'} on table ${String(g?.table_id ?? '?').slice(0, 8)}…`).join('; ')}`)
      if (oc?.data_access?.mode === 'all') warnings.push('Data access to ALL tables')
      if (oc?.task_access) warnings.push('Task access (can act on tasks)')
      if (oc?.workflow_access) warnings.push('Workflow access (can start workflows)')
      if (list(oc?.egress?.allowed_hosts).length) warnings.push(`Can call: ${quote(list(oc.egress.allowed_hosts).map(String))}`)
      if (oc?.document_access) lines.push('Document tools')
      if (creating) lines.push('Created inactive — test it in the playground, then turn it on')
      break
    }
    case 'email_templates_create':
    case 'email_templates_update':
      if (args.subject !== undefined) lines.push(`Subject: “${String(args.subject).slice(0, 120)}”`)
      if (args.html_body !== undefined || args.text_body !== undefined) lines.push(`${creating ? 'Body' : 'New body'} (${String(args.html_body ?? args.text_body).replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length} words)`)
      if (!creating) warnings.push('Workflows using this template send the new version')
      break
    case 'integrations_test':
      lines.push('Makes a live test call with the saved credentials (nothing is changed)')
      break
  }
  if (!lines.length) lines.push(creating ? `Create the ${noun}` : `Update the ${noun}`)
  return { title, lines, warnings, ...(preview ? { preview } : {}) }
}

/* ── Data rows: previews on the confirmation card ── */

/** Rows shown on a card. */
export const ROW_PREVIEW = 10
/** Deletes of more rows than this need the count typed to confirm. */
export const TYPED_DELETE_THRESHOLD = 25

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') { try { return JSON.stringify(v).slice(0, 80) } catch { return '…' } }
  return String(v).slice(0, 80)
}

function tableColumns(table: any): Array<{ key: string; name: string; secret: boolean }> {
  const cols = list(table?.columns ?? table?.schema?.columns)
  return cols.filter((c: any) => c && (c.key || c.name)).map((c: any) => ({ key: String(c.key ?? c.name), name: String(c.name ?? c.key), secret: c.type === 'secret' || c.secret === true || c.redacted === true }))
}

function previewOf(columns: Array<{ key: string; name: string; secret: boolean }>, rows: Array<Record<string, any>>, total: number, caption?: string) {
  const used = columns.filter((c) => rows.some((r) => r[c.key] !== undefined || r[c.name] !== undefined)).slice(0, 8)
  const cols = used.length ? used : columns.slice(0, 8)
  return {
    columns: cols.map((c) => c.name),
    rows: rows.slice(0, ROW_PREVIEW).map((r) => cols.map((c) => (c.secret ? '••••' : cell(r[c.key] ?? r[c.name])))),
    total,
    ...(caption ? { caption } : {}),
  }
}

/** The card for a row write: a table preview of what is created / changed / deleted. */
export async function describeRowWrite(tool: string, args: Record<string, any>, read: (name: string, a: Record<string, any>) => Promise<any>) {
  const tablePayload = await read('data_tables_get', { table_id: args.table_id })
  if (tablePayload?.error) throw new Error(`Can't find that table: ${tablePayload.error}`)
  const table = tablePayload?.table ?? tablePayload
  const tableName = String(table?.name ?? args.table_id)
  const columns = tableColumns(table)
  const triggers = 'Workflows triggered by row changes on this table run for each row, as usual.'
  const matched = async (): Promise<any[]> => {
    const ids: string[] = Array.isArray(args.row_ids) ? args.row_ids.map(String) : []
    if (ids.length) {
      const rows = await Promise.all(ids.slice(0, 200).map((id) => read('data_rows_get', { table_id: table?.id ?? args.table_id, row_id: id })))
      return rows.map((r) => r?.row).filter(Boolean)
    }
    if (!Array.isArray(args.filters) || !args.filters.length) throw new Error('Say which rows: row_ids or filters')
    const max = Math.min(Math.max(1, Math.floor(Number(args.max_rows) || 50)), 200)
    const res = await read('data_rows_query', { table_id: table?.id ?? args.table_id, filters: args.filters, limit: max + 1 })
    if (res?.error) throw new Error(res.error)
    const rows = list(res?.rows)
    if (rows.length > max || Number(res?.total_matches) > max) throw new Error(`More than ${max} rows match — narrow the filters (or raise max_rows, at most 200)`)
    if (res?.truncated) throw new Error('The table is too large to filter in one call — pass row_ids')
    return rows
  }
  const rowData = (r: any) => ({ id: r?.id, ...(r?.data ?? {}) })
  if (tool === 'data_rows_create') {
    const rows = list(args.rows)
    if (!rows.length) throw new Error('No rows to add')
    if (rows.length > 200) throw new Error('At most 200 rows per call — split it')
    return {
      title: `Add ${rows.length} row${rows.length === 1 ? '' : 's'} to “${tableName}”`,
      lines: [`${rows.length} new row${rows.length === 1 ? '' : 's'}${rows.length > ROW_PREVIEW ? ` (first ${ROW_PREVIEW} shown)` : ''}`],
      warnings: [triggers],
      preview: previewOf(columns, rows, rows.length),
    }
  }
  const rows = await matched()
  if (!rows.length) throw new Error('No rows match — nothing to change')
  if (tool === 'data_rows_update') {
    const data = json(args.data) ?? {}
    const keys = Object.keys(data)
    const changed = columns.filter((c) => keys.includes(c.key) || keys.includes(c.name))
    const sample = rows.slice(0, ROW_PREVIEW).map(rowData)
    const preview = {
      columns: ['Row', ...changed.slice(0, 4).flatMap((c) => [`${c.name} (before)`, `${c.name} (after)`])],
      rows: sample.map((r: any) => [cell(r.id).slice(0, 8), ...changed.slice(0, 4).flatMap((c) => c.secret ? ['••••', '••••'] : [cell(r[c.key] ?? r[c.name]), cell(data[c.key] ?? data[c.name])])]),
      total: rows.length,
      caption: 'Before → after for a sample of the matched rows',
    }
    return {
      title: `Update ${rows.length} row${rows.length === 1 ? '' : 's'} in “${tableName}”`,
      lines: [`Set ${quote(changed.map((c) => c.name).length ? changed.map((c) => c.name) : keys)} on ${rows.length} row${rows.length === 1 ? '' : 's'}`],
      warnings: [triggers],
      preview,
    }
  }
  // data_rows_bulk_delete
  const n = rows.length
  return {
    title: `Delete ${n} row${n === 1 ? '' : 's'} from “${tableName}”`,
    lines: [`These ${n} row${n === 1 ? '' : 's'} will be deleted`],
    warnings: ['Deleted rows cannot be restored from here.', triggers],
    preview: previewOf(columns, rows.map(rowData), n, 'Rows to delete'),
    danger: true,
    confirm_label: `Delete ${n} row${n === 1 ? '' : 's'}`,
    ...(n > TYPED_DELETE_THRESHOLD ? { typed_confirm: `delete ${n}` } : {}),
    // The delete runs on exactly these ids (not the filter again), so the card is what happens.
    resolved_row_ids: rows.map((r: any) => String(r.id)),
  }
}

/* ── Compact list results (so a long list never cuts off the item being looked for) ── */

const LIST_KEYS = ['tables', 'workflows', 'forms', 'decision_tables', 'activities', 'workflow_activities', 'controls', 'form_controls', 'items', 'data']

/** A list tool's payload with each item reduced to id / name / a few facts. */
export function compactListPayload(payload: any): any {
  if (!payload || typeof payload !== 'object' || payload.error) return payload
  const key = LIST_KEYS.find((k) => Array.isArray(payload[k]))
  const items = key ? payload[key] : Array.isArray(payload) ? payload : null
  if (!items) return payload
  const compact = items.map((it: any) => {
    const out: Record<string, unknown> = { id: it?.id, name: it?.name ?? it?.title ?? it?.label }
    if (it?.slug) out.system_name = it.slug
    if (it?.system_name) out.system_name = it.system_name
    if (Array.isArray(it?.columns)) out.columns = it.columns.length
    if (Array.isArray(it?.fields)) out.fields = it.fields.length
    if (it?.status) out.status = it.status
    if (typeof it?.is_active === 'boolean') out.is_active = it.is_active
    if (it?.trigger_type) out.trigger_type = it.trigger_type
    if (it?.version !== undefined) out.version = it.version
    return out
  })
  return { ...(Array.isArray(payload) ? {} : payload), [key ?? 'items']: compact, count: compact.length, note: 'Compact list (id, name, counts). Use the get tool with an id for details; pass query to filter by name.' }
}

/**
 * Deferred tool groups: tools rarely needed to build a process stay out of
 * the tool list (resent on every call) until load_tools offers them, the
 * conversation already used one of them, or the builder open on screen is
 * their area.
 */
export const TOOL_GROUPS: Record<string, { label: string; match: RegExp; areas: string[] }> = {
  rows: { label: 'data rows: add (incl. sample data), query, update and delete rows', match: /^data_rows_/, areas: ['data'] },
  extensibility: { label: 'custom workflow actions and custom form controls', match: /^(workflow_activities_|form_controls_)/, areas: ['extensibility'] },
  email: { label: 'email templates', match: /^email_templates_/, areas: ['email_template'] },
  agents: { label: 'AI agents', match: /^agents_/, areas: ['agent'] },
  integrations: { label: 'integrations and connectors (and testing a connection)', match: /^(integrations_|connectors_)/, areas: ['integration'] },
  reports: { label: 'report previews and report sources', match: /^reports_(preview|sources_list|source_get)$/, areas: ['report'] },
}

export const LOAD_TOOLS = 'load_tools'

export function toolGroupOf(name: string): string | null {
  for (const [group, g] of Object.entries(TOOL_GROUPS)) if (g.match.test(name)) return group
  return null
}

function loadToolsTool(groups: string[]): AssistantToolDef {
  return {
    name: LOAD_TOOLS,
    description: `Offer more tools from the next step on. Groups: ${groups.map((g) => `${g} (${TOOL_GROUPS[g].label})`).join('; ')}. Load a group only when the request needs it.`,
    parameters: { type: 'object', properties: { groups: { type: 'array', items: { type: 'string', enum: groups } } }, required: ['groups'] },
    mode: 'read',
    label: () => 'Loading more tools',
    run: async (args) => {
      const wanted = (Array.isArray(args.groups) ? args.groups : [args.groups]).map(String).filter((g: string) => groups.includes(g))
      if (!wanted.length) return { result: { error: `Unknown group — one of ${groups.join(', ')}` }, ok: false }
      return { result: { loaded: wanted, note: 'These tools are offered from your next step.' }, activateGroups: wanted }
    },
  }
}

export interface DesignerToolsParams {
  /** The person's MCP-bound tool server (createMcpServer with a user context). */
  server: McpToolServer
  permissions: ReadonlySet<string>
  /** The builder open on screen (its area's tool group is offered from the start). */
  area?: string | null
  /** Test seam: offer every tool from the start (no deferred groups). */
  allTools?: boolean
  /** Test seam: the workflow self-check (lib/assistants/workflow-check). */
  checkWorkflow?: (args: Record<string, any>, read: (name: string, a: Record<string, any>) => Promise<any>) => string[] | Promise<string[]>
}

/** Thrown by a workflow write's card when the self-check wants one correction round first. */
export const SELF_CHECK_PREFIX = 'Self-check before showing this to the person'

/** The self-check, with the linked forms read as the person (forms_get) so form / task field references are checked. */
const defaultWorkflowCheck = async (args: Record<string, any>, read: (name: string, a: Record<string, any>) => Promise<any>): Promise<string[]> => {
  const draft = draftFromArgs(args)
  if (!draft) return []
  const formIds = [...new Set((draft.nodes as any[]).map((n) => n?.config?.form_id).filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 10)
  const linkedForms: Record<string, any> = {}
  await Promise.all(formIds.map(async (id) => {
    const payload = await read('forms_get', { form_id: id }).catch(() => null)
    const form = payload?.form ?? payload
    if (form && !payload?.error) linkedForms[id] = { fields: form.fields, layout: form.layout, version: form.version, name: form.name }
  }))
  return workflowWarnings({ ...draft, linkedForms })
}

export function designerTools({ server, permissions, area = null, allTools = false, checkWorkflow = defaultWorkflowCheck }: DesignerToolsParams): AssistantToolDef[] {
  const catalog = getMcpToolCatalog()
  const byName = new Map(catalog.tools.map((t) => [t.name, t]))
  const call = async (name: string, rawArgs: Record<string, any>) => {
    const handler = server.getHandler(name)
    const validator = catalog.inputSchemas.get(name)
    if (!handler || !validator) return { error: `Tool ${name} is not available` }
    const parsed = await (validator as any).safeParseAsync(rawArgs)
    if (!parsed.success) return { error: `Invalid arguments for ${name}: ${String(parsed.error?.message ?? parsed.error).slice(0, 500)}` }
    try {
      return mcpPayload(await handler(parsed.data))
    } catch (error) {
      return { error: (error as Error)?.message || 'The tool failed' }
    }
  }
  const read = (name: string, a: Record<string, any>) => call(name, a)
  const pinnedRows = new Map<string, string[]>()
  // One automatic correction round per workflow write (per request), then the card shows what is left.
  const selfChecked = new Set<string>()
  // Failed theme checks per tool (theme-reference.ts): an invalid theme never reaches a card.
  const themeFails = new Map<string, number>()

  const allowed = allowedDesignerToolNames(permissions)
  // The solution builder: for people who can create at least one kind of item.
  const createTools = new Set([...allowed, ...(holdsPermission(permissions, requiredToolPermission('reports_create') ?? 'reports.create') ? ['reports_create'] : [])].filter((n) => Object.values(CREATE_TOOL).includes(n)))
  const planTools = createTools.size ? buildPlanTools({ call, allowedTools: createTools, draftOnly: draftOnlyArgs }) : []
  // The build reference: for anyone who can see workflows or build something.
  const canReference = allowed.includes('workflows_catalog') || createTools.size > 0
  const referenceTools = canReference ? [nodeReferenceTool({
    itemSchema: (tool) => {
      const def = byName.get(tool)
      if (!def || !(allowed.includes(tool) || createTools.has(tool))) return null
      return { description: String(def.description ?? tool).slice(0, 6_000), parameters: schemaFor(tool, def.inputSchema) }
    },
  })] : []
  // The theme reference: for people who can create or change forms.
  if (allowed.includes('forms_update') || allowed.includes('forms_create')) referenceTools.push(themeReferenceTool())

  const out: AssistantToolDef[] = [...allowed.flatMap((name): AssistantToolDef[] => {
    const def = byName.get(name)
    if (!def) return []
    const write = WRITE_SET.has(name)
    const { kind, noun } = kindOf(name)
    const refKind = canReference ? referenceKindOf(name) : null
    return [{
      name,
      description: refKind ? shorten(String(def.description ?? name), TOOL_DESCRIPTION_MAX, refKind) : String(def.description ?? name),
      parameters: trimSchema(refKind && /_update(_schema)?$/.test(name) && byName.has(ITEM_REFERENCE[refKind]) ? collapseUpdateItems(schemaFor(name, def.inputSchema), ITEM_REFERENCE[refKind]) : schemaFor(name, def.inputSchema), refKind),
      mode: write ? 'write' : 'read',
      ...(name.endsWith('_list') ? { maxResultChars: 12_000 } : COMPACT_READ_TOOLS.has(name) ? { maxResultChars: 30_000 } : {}),
      label: (args) => (write
        ? name === 'data_rows_create' ? `Adding ${Array.isArray(args.rows) ? args.rows.length : ''} rows`.replace('  ', ' ')
          : name === 'data_rows_update' ? 'Updating rows' : name === 'data_rows_bulk_delete' ? 'Deleting rows'
          : `${name.endsWith('_create') ? 'Creating' : 'Updating'} the ${noun}${args.name ? ` “${String(args.name).slice(0, 60)}”` : ''}`
        : name === 'workflows_catalog' ? 'Reading the step catalog'
        : name === 'data_rows_query' ? 'Reading rows'
        : name.endsWith('_list') ? `Looking up ${noun}s`
        : name.endsWith('_test') ? `Testing the ${noun}`
        : name.endsWith('_preflight') || name.endsWith('_accessibility') ? `Checking the ${noun}`
        : `Reading the ${noun}`),
      confirm: write ? async (args) => {
        const safe = draftOnlyArgs(name, args)
        if (name === 'form_controls_create') {
          const manifest = json(safe.manifest)
          if (!safe.module || !manifest?.tag) throw new Error('Send the control as `module` (ES module source) and `manifest` (with a tag)')
          const existing = await read('form_controls_get', { form_control_id: String(manifest.tag) })
          if (existing && !existing.error) throw new Error(`A control <${manifest.tag}> already exists — new versions of an existing control are added in Extensibility`)
        }
        if (name.startsWith('data_rows_')) {
          const card = await describeRowWrite(name, safe, read)
          // A filtered delete runs on exactly the rows the card showed.
          if (name === 'data_rows_bulk_delete' && (card as any).resolved_row_ids) {
            pinnedRows.set(JSON.stringify(args), (card as any).resolved_row_ids)
            delete (card as any).resolved_row_ids
          }
          return card
        }
        if (name === 'workflows_create' || name === 'workflows_update') {
          const warnings = await checkWorkflow(safe, read)
          const key = `${name}:${String(safe.workflow_id ?? safe.name ?? '')}`
          if (warnings.length && !selfChecked.has(key)) {
            selfChecked.add(key)
            throw new Error(`${SELF_CHECK_PREFIX}: ${warnings.length} possible wiring issue${warnings.length === 1 ? '' : 's'} — fix them (see the wiring guide) and call ${name} again with the corrected workflow; if one is intended, call again unchanged:\n- ${warnings.join('\n- ')}`)
          }
          const card = await describeWrite(name, safe, read)
          if (warnings.length) card.warnings.unshift(`${warnings.length} possible wiring issue${warnings.length === 1 ? '' : 's'}: ${warnings.slice(0, 5).join('; ')}${warnings.length > 5 ? '; …' : ''}`)
          return card
        }
        const themeError = themeCheckError(name, safe, (themeFails.get(name) ?? 0) + 1)
        if (themeError) { themeFails.set(name, (themeFails.get(name) ?? 0) + 1); throw new Error(themeError) }
        return describeWrite(name, safe, read)
      } : undefined,
      run: async (args, env) => {
        let safe = write ? draftOnlyArgs(name, args) : args
        if (name === 'data_rows_bulk_delete') {
          // The ids the card showed (recomputed when the card came from an earlier request).
          const ids = pinnedRows.get(JSON.stringify(args)) ?? (await describeRowWrite(name, safe, read) as any).resolved_row_ids
          safe = { table_id: safe.table_id, row_ids: ids }
        }
        let filter: string | null = null
        if (name.endsWith('_list')) ({ args: safe, filter } = listArgs(def.inputSchema, safe))
        if (!write && WRAPPER_ARGS.some((k) => k in safe)) { safe = { ...safe }; for (const k of WRAPPER_ARGS) delete safe[k] }
        const raw = await call(name, safe)
        let payload = name.endsWith('_list') ? compactListPayload(raw) : write ? raw : compactRead(name, args, raw)
        if (filter && payload && !payload.error) {
          const key = Object.keys(payload).find((k) => Array.isArray(payload[k]))
          if (key) { const f = filter.toLowerCase(); const items = payload[key].filter((it: any) => String(it?.name ?? '').toLowerCase().includes(f)); payload = { ...payload, [key]: items, count: items.length } }
        }
        if (payload?.error) return { result: payload, ok: false }
        if (name === 'integrations_test') return { result: payload }
        if (write && name.startsWith('data_rows_')) {
          const count = Number(payload?.created ?? payload?.updated ?? payload?.deleted ?? 0)
          const tableId = payload?.table_id ?? (/^[0-9a-f-]{36}$/i.test(String(safe.table_id)) ? safe.table_id : null)
          env.emit({ type: 'changed', kind: 'data_rows', id: tableId, title: `${count} row${count === 1 ? '' : 's'}`, href: hrefFor('data_rows', tableId), action: name === 'data_rows_create' ? 'created' : name === 'data_rows_update' ? 'updated' : 'deleted' })
        } else if (write) {
          const item = changedItem(name, safe, payload)
          if (name === 'form_controls_create' && item.id) {
            // Never active on its own: disable the new control (an admin enables it).
            await call('form_controls_update', { form_control_id: item.id, enabled: false })
          }
          env.emit({ type: 'changed', kind, id: item.id, title: item.name ?? noun, href: hrefFor(kind, item.id), action: name.endsWith('_create') ? 'created' : 'updated' })
        }
        return { result: payload }
      },
    }]
  }), ...planTools, ...referenceTools]
  // Deferred groups (not for the open builder's area).
  const deferred = new Set<string>()
  if (!allTools) for (const t of out) { const g = toolGroupOf(t.name); if (g && !(area && TOOL_GROUPS[g].areas.includes(area))) { t.group = g; deferred.add(g) } }
  return deferred.size ? [...out, loadToolsTool([...deferred])] : out
}

/** The MCP context for a signed-in person (as a user API key would be): their permissions, every resource. */
export function personMcpContext(params: { tenantId: string; userId: string; permissions: ReadonlySet<string>; serviceDb: unknown }): McpContext {
  return {
    tenantId: params.tenantId,
    supabase: params.serviceDb,
    actingUserId: params.userId,
    keyType: 'user',
    permissions: [...params.permissions],
    scopes: { workflow_ids: [], table_ids: [] },
    credentialOwnerId: params.userId,
    // Audit rows of the Agent's changes say so (metadata agent: true).
    via: 'agent',
  }
}
