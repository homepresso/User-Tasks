/**
 * Compact read results for the Agent (pure). Every result the model reads is
 * resent on each later call of the request, so reads return a summary by
 * default — what an item is and how it is wired — and the full item only
 * when asked (`detail: true`, needed to edit it with its update tool).
 *
 *  - workflows_get / workflows_get_definition: name, trigger, steps (id,
 *    type, label, the key settings shortened), edges as "a → b (label)",
 *    variable names. `node_ids` returns those steps' full config.
 *  - forms_get: fields (key, label, type, required, options), sections /
 *    pages, buttons.
 *  - decision_tables_get: inputs, outputs, the first rules.
 *  - data_tables_get: columns (key, name, type and the settings that matter).
 *  - workflows_catalog: one line per node type (the configs come from
 *    workflow_node_reference), no recipes.
 * Noise is dropped everywhere: canvas positions, sizes, styles, cached copies
 * of a linked form's fields, private `_…` keys, timestamps.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- MCP payloads are JSON */

export const DETAIL_PARAM = { type: 'boolean', description: 'Return the full item with every setting (needed to edit it with its update tool). Default: a compact summary.' }
export const NODE_IDS_PARAM = { type: 'array', items: { type: 'string' }, description: 'Also return the full config of these step ids (with the summary)' }

/** Read tools that summarise by default. */
export const COMPACT_READ_TOOLS = new Set(['workflows_get', 'workflows_get_definition', 'forms_get', 'decision_tables_get', 'data_tables_get'])

const NOISE_KEYS = new Set(['position', 'positionAbsolute', 'width', 'height', 'style', 'selected', 'dragging', 'measured', 'collapsed', 'sectionId', 'created_at', 'updated_at', 'created_by', 'updated_by', 'tenant_id'])

/** A config value shortened for a summary: long text cut, big arrays / objects counted. */
function shortValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 117)}…` : v
  if (Array.isArray(v)) {
    const text = JSON.stringify(v)
    if (text.length <= 240) return v
    const count = `[${v.length} item${v.length === 1 ? '' : 's'}]`
    if (depth >= 1 || v.length > 6) return count
    const short = v.map((x) => shortValue(x, depth + 1))
    return JSON.stringify(short).length <= 400 ? short : count
  }
  if (v && typeof v === 'object') {
    const text = JSON.stringify(v)
    if (text.length <= 240) return v
    if (depth >= 1) return `{${Object.keys(v).length} keys}`
    return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_') && !NOISE_KEYS.has(k)).map(([k, x]) => [k, shortValue(x, depth + 1)]))
  }
  return v
}

/** A node's config without noise: private keys, cached form copies (a linked form_id carries them), layout / theme blobs. */
export function cleanConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}
  const c = config as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(c)) {
    if (k.startsWith('_') || NOISE_KEYS.has(k)) continue
    // A linked form keeps a cached copy of its fields / layout: the form itself is the source.
    if (c.form_id && (k === 'fields' || k === 'form_layout' || k === 'form_theme' || k === 'form_version')) continue
    out[k] = v
  }
  return out
}

function summaryConfig(config: unknown): Record<string, unknown> {
  const c = cleanConfig(config)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(c)) {
    if (k === 'fields' && Array.isArray(v)) { out.fields = v.map((f: any) => String(f?.key ?? f?.label ?? '')).filter(Boolean).slice(0, 30); continue }
    if (k === 'form_layout' || k === 'form_theme') continue
    out[k] = shortValue(v)
  }
  return out
}

/** A workflow (workflows_get row or workflows_get_definition document) as a summary. */
export function summarizeWorkflow(payload: any, nodeIds: string[] = []): any {
  if (!payload || typeof payload !== 'object' || payload.error) return payload
  const wf = payload.definition ?? payload.workflow ?? payload
  const nodes: any[] = Array.isArray(wf?.nodes) ? wf.nodes : []
  const edges: any[] = Array.isArray(wf?.edges) ? wf.edges : []
  const want = new Set(nodeIds.map(String))
  return {
    workflow_id: payload.workflow_id ?? wf?.id ?? null,
    name: wf?.name ?? null,
    ...(wf?.description ? { description: shortValue(wf.description) } : {}),
    trigger_type: wf?.trigger_type ?? null,
    ...(wf?.trigger_config && Object.keys(cleanConfig(wf.trigger_config)).length ? { trigger_config: summaryConfig(wf.trigger_config) } : {}),
    ...(wf?.is_active !== undefined ? { is_active: wf.is_active } : {}),
    steps: nodes.map((n) => ({
      id: n?.id,
      type: n?.type,
      ...(n?.label ? { label: n.label } : {}),
      config: want.has(String(n?.id)) ? cleanConfig(n?.config) : summaryConfig(n?.config),
      ...(n?.onError && n.onError !== 'stop' ? { onError: n.onError } : {}),
    })),
    edges: edges.map((e) => `${String(e?.source)} → ${String(e?.target)}${e?.label ? ` (${e.label})` : ''}`),
    ...(Array.isArray(wf?.user_variables) && wf.user_variables.length ? { user_variables: wf.user_variables.map((v: any) => String(v?.name ?? v?.key ?? v)).slice(0, 40) } : {}),
    ...(Array.isArray(wf?.sections) && wf.sections.length ? { sections: wf.sections.map((s: any) => String(s?.label ?? s?.id)).slice(0, 20) } : {}),
    ...(Array.isArray(payload.recent_runs) ? { recent_runs: payload.recent_runs } : {}),
    summary: true,
    note: 'Compact summary: settings are shortened, canvas positions and cached form copies left out. Pass node_ids for some steps\' full config, or detail: true for the whole definition (needed to edit it with workflows_update).',
  }
}

function fieldSummary(f: any): Record<string, unknown> {
  const out: Record<string, unknown> = { key: f?.key ?? f?.id, label: f?.label, type: f?.type }
  if (f?.required) out.required = true
  if (f?.read_only || f?.readOnly) out.read_only = true
  const options = Array.isArray(f?.options) ? f.options.map((o: any) => (typeof o === 'object' && o ? o.label ?? o.value : o)) : null
  if (options?.length) out.options = options.length > 8 ? [...options.slice(0, 8), `… ${options.length - 8} more`] : options
  if (f?.default !== undefined && f?.default !== '' && f?.default !== null) out.default = shortValue(f.default)
  if (f?.visible_when) out.conditional = true
  return out
}

/** forms_get as a summary. */
export function summarizeForm(payload: any): any {
  if (!payload || typeof payload !== 'object' || payload.error) return payload
  const form = payload.form ?? payload
  const fields: any[] = Array.isArray(form?.fields) ? form.fields : []
  const layout = form?.layout && typeof form.layout === 'object' ? form.layout : null
  const sections = Array.isArray(layout?.sections) ? layout.sections : Array.isArray(layout?.pages) ? layout.pages : []
  return {
    form: {
      id: form?.id ?? null,
      name: form?.name ?? null,
      ...(form?.description ? { description: shortValue(form.description) } : {}),
      ...(form?.version !== undefined ? { version: form.version } : {}),
      fields: fields.map(fieldSummary),
      ...(sections.length ? { sections: sections.map((s: any) => String(s?.title ?? s?.label ?? s?.id ?? '')).slice(0, 20) } : {}),
      ...(Array.isArray(form?.buttons) && form.buttons.length ? { buttons: form.buttons.map((b: any) => String(b?.label ?? b?.id ?? '')) } : {}),
      ...(Array.isArray(form?.usages) ? { used_by: form.usages.length } : {}),
    },
    summary: true,
    note: 'Compact summary of the form. Pass detail: true for every field setting, the layout and the theme (needed to edit it with forms_update).',
  }
}

/** decision_tables_get as a summary. */
export function summarizeDecisionTable(payload: any): any {
  if (!payload || typeof payload !== 'object' || payload.error) return payload
  const t = payload.decision_table ?? payload
  const io = (xs: any) => (Array.isArray(xs) ? xs.map((x: any) => ({ key: x?.key ?? x?.name, label: x?.label, type: x?.type })) : [])
  const rules: any[] = Array.isArray(t?.rules) ? t.rules : []
  return {
    decision_table: {
      id: t?.id ?? null,
      name: t?.name ?? null,
      ...(t?.description ? { description: shortValue(t.description) } : {}),
      inputs: io(t?.inputs),
      outputs: io(t?.outputs),
      rule_count: rules.length,
      rules: rules.slice(0, 5).map((r) => shortValue(Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => !NOISE_KEYS.has(k))))),
    },
    summary: true,
    note: `Compact summary${rules.length > 5 ? ' (first 5 rules)' : ''}. Pass detail: true for every rule (needed to edit it with decision_tables_update).`,
  }
}

/** data_tables_get without noise (columns with the settings that matter). */
export function summarizeDataTable(payload: any): any {
  if (!payload || typeof payload !== 'object' || payload.error) return payload
  const t = payload.table ?? payload
  const cols: any[] = Array.isArray(t?.columns) ? t.columns : Array.isArray(t?.schema?.columns) ? t.schema.columns : []
  return {
    table: {
      id: t?.id ?? null,
      name: t?.name ?? null,
      ...(t?.slug ? { system_name: t.slug } : {}),
      ...(t?.description ? { description: shortValue(t.description) } : {}),
      columns: cols.map((c) => {
        const out: Record<string, unknown> = { key: c?.key ?? c?.name, name: c?.name ?? c?.key, type: c?.type }
        if (c?.required) out.required = true
        if (Array.isArray(c?.options) && c.options.length) out.options = c.options.slice(0, 10).map((o: any) => (typeof o === 'object' && o ? o.label ?? o.value : o))
        if (c?.lookup || c?.lookup_table_id) out.lookup = shortValue(c.lookup ?? { table_id: c.lookup_table_id })
        return out
      }),
      ...(t?.row_count !== undefined ? { row_count: t.row_count } : {}),
    },
    summary: true,
    note: 'Columns of the table. Pass detail: true for every setting (lookups, validation, retention).',
  }
}

/** The step catalog as one line per type; configs come from workflow_node_reference. */
export function compactCatalog(payload: any): any {
  if (!payload || typeof payload !== 'object' || payload.error) return payload
  const line = (n: any) => `${n?.type} — ${n?.label}: ${n?.description}`
  const groups: Record<string, string[]> = {}
  for (const n of Array.isArray(payload.node_types) ? payload.node_types : []) (groups[String(n?.category ?? 'other')] ??= []).push(line(n))
  return {
    trigger_types: (Array.isArray(payload.trigger_types) ? payload.trigger_types : []).map(line),
    node_types: groups,
    build_order: payload.guidance?.recommended_app_build_order ?? ['data_tables', 'decision_tables', 'workflow_activities', 'workflows'],
    note: 'One line per type. Call workflow_node_reference with the types you will use for their config keys, required settings, outputs and an example — do not read existing workflows to learn the format.',
  }
}

/** A read tool's result for the model: the summary unless the full item was asked for. */
export function compactRead(name: string, args: Record<string, any>, payload: any): any {
  if (name === 'workflows_catalog') return compactCatalog(payload)
  if (!COMPACT_READ_TOOLS.has(name) || args?.detail === true) return payload
  switch (name) {
    case 'workflows_get':
    case 'workflows_get_definition': return summarizeWorkflow(payload, Array.isArray(args?.node_ids) ? args.node_ids : [])
    case 'forms_get': return summarizeForm(payload)
    case 'decision_tables_get': return summarizeDecisionTable(payload)
    case 'data_tables_get': return summarizeDataTable(payload)
    default: return payload
  }
}
