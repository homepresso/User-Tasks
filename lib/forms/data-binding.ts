/**
 * Data binding: a form tied to a data source whose fields the designer
 * offers in its Data panel (drag a source field onto the canvas → an input
 * bound to it). Two kinds of source, one designer contract (the extension
 * SDK's FormTargetDescription / FormTargetSourceField / FormTargetMapping,
 * lib/extensions/sdk):
 *
 *  - `layout.data_target` (lib/forms/data-target.ts) — a record an EXTENSION
 *    provides (a SharePoint list item …): where the form LOADS FROM AND SAVES
 *    TO. The provider owns its mapping (inside data_target.config); the
 *    designer reads it through `describe` and changes it through `bind`.
 *  - `layout.data_binding` (this file) — a core source the form reads from
 *    and, where core already has a safe write path, writes to:
 *
 *      layout.data_binding = { kind, source_id, integration_id?, label?,
 *                              fields: { <form field key>: <source field key> },
 *                              record_param?, inputs?, save? }
 *
 *    kind `table` — a Data table: `fields` maps form fields to columns. With
 *      `record_param` (a declared URL parameter holding a row id) the row
 *      loads when the form opens; with `save` the row is written when the
 *      form is submitted (updated when the parameter names one, else a new
 *      row).
 *    kind `reference` — an Integrations API reference (custom reference or a
 *      connector's reference): `fields` maps form fields to response paths
 *      (`name`, `data.email`, `[0].id`); `inputs` fills the reference's
 *      inputs (templates, e.g. {{param.customer_id}}). Read / prefill only:
 *      API references are never called to save a submission.
 *
 * Why a separate key and not data_target: data_target means "the record this
 * form saves to, through a provider's submit hook" (core refuses display
 * submissions, runs the provider's prepare / submit, its identity rules …).
 * A core binding never replaces the submission: it is a read (and optional
 * table write) source expressed as ordinary form rules, so it must not
 * trigger any of the data_target machinery. A form has one or the other.
 *
 * Runtime: no new path. The binding is compiled into MANAGED form rules
 * (ids `data_binding_*`, regenerated whenever the layout is normalised, so
 * they always match the binding): a "Form loads" rule with Read a row /
 * Call an API reference whose outputs fill the bound fields, and for saving
 * tables "Before submit" rules with Create a row / Update a row whose column
 * values are the bound fields. Those run through the existing server-side
 * rule actions (lib/services/form-rule-actions.ts): looked up from the SAVED
 * form, the person's own data rights (data.view / data.manage_rows), audited.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { FormRule } from './form-rules'

export type DataBindingKind = 'table' | 'reference'
export const DATA_BINDING_KINDS: DataBindingKind[] = ['table', 'reference']

export interface FormDataBinding {
  kind: DataBindingKind
  /** custom_tables.id (table) or integration_references.id (reference). */
  source_id: string
  /** reference: the reference's integration. */
  integration_id?: string
  /** What the designer calls the source ("Customers"). */
  label?: string
  /** Form field key → source field key (table: column key; reference: response path). */
  fields: Record<string, string>
  /** table: the URL parameter (layout.params) holding the row id to load / update. */
  record_param?: string
  /** reference: input name → template ({{param.x}}, {{field}}, a constant). */
  inputs?: Record<string, string>
  /** table: write the row when the form is submitted (update with record_param's row, else create). */
  save?: boolean
}

export const DATA_BINDING_LIMITS = { fields: 300, inputs: 40, sourceKey: 200, label: 200, template: 500 } as const
/** Ids of the rules a binding manages (never edited by hand: regenerated from the binding). */
export const BINDING_RULE_PREFIX = 'data_binding_'
export const BINDING_RULE_IDS = { load: 'data_binding_load', create: 'data_binding_save_new', update: 'data_binding_save_edit' } as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/
const PARAM_RE = /^[a-z][a-z0-9_]{0,40}$/i
const INPUT_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/
/** Table column keys and response paths (`data.items[0].name`, `@odata.count`). */
const SOURCE_KEY_RE = /^[A-Za-z0-9_@$[\].-]{1,200}$/
const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f]/g, '').slice(0, max)

export function isBindingRuleId(id: string): boolean {
  return id.startsWith(BINDING_RULE_PREFIX)
}

/**
 * A stored binding → a clean one, or undefined. `fieldKeys` (when given)
 * drops mappings of fields the form no longer has.
 */
export function normalizeDataBinding(raw: unknown, fieldKeys?: Iterable<string>): FormDataBinding | undefined {
  if (!isPlainObject(raw)) return undefined
  const kind = DATA_BINDING_KINDS.includes(raw.kind as DataBindingKind) ? raw.kind as DataBindingKind : null
  const sourceId = typeof raw.source_id === 'string' ? raw.source_id : ''
  if (!kind || !UUID_RE.test(sourceId)) return undefined
  const known = fieldKeys ? new Set(fieldKeys) : null
  const fields: Record<string, string> = {}
  if (isPlainObject(raw.fields)) {
    for (const [key, source] of Object.entries(raw.fields).slice(0, DATA_BINDING_LIMITS.fields)) {
      if (!FIELD_KEY_RE.test(key) || typeof source !== 'string' || !SOURCE_KEY_RE.test(source)) continue
      if (known && !known.has(key)) continue
      fields[key] = source
    }
  }
  const out: FormDataBinding = { kind, source_id: sourceId.toLowerCase(), fields }
  if (kind === 'reference' && typeof raw.integration_id === 'string' && UUID_RE.test(raw.integration_id)) out.integration_id = raw.integration_id.toLowerCase()
  const label = typeof raw.label === 'string' ? clean(raw.label.trim(), DATA_BINDING_LIMITS.label) : ''
  if (label) out.label = label
  if (kind === 'table') {
    if (typeof raw.record_param === 'string' && PARAM_RE.test(raw.record_param)) out.record_param = raw.record_param
    if (raw.save === true) out.save = true
  }
  if (kind === 'reference' && isPlainObject(raw.inputs)) {
    const inputs: Record<string, string> = {}
    for (const [name, template] of Object.entries(raw.inputs).slice(0, DATA_BINDING_LIMITS.inputs)) {
      if (INPUT_RE.test(name) && typeof template === 'string' && template.trim()) inputs[name] = clean(template, DATA_BINDING_LIMITS.template)
    }
    if (Object.keys(inputs).length) out.inputs = inputs
  }
  return out
}

/** The layout's core binding, if any (a form bound to an extension target has none: data_target wins). */
export function layoutDataBinding(layout: unknown): FormDataBinding | undefined {
  if (!isPlainObject(layout) || isPlainObject(layout.data_target)) return undefined
  return normalizeDataBinding(layout.data_binding)
}

/** A field key renamed in the designer: the mapping follows it. */
export function renameBindingKey(binding: FormDataBinding, from: string, to: string): FormDataBinding {
  if (!(from in binding.fields) || from === to) return binding
  const fields: Record<string, string> = {}
  for (const [key, source] of Object.entries(binding.fields)) fields[key === from ? to : key] = source
  return { ...binding, fields }
}

/** A field removed from the form: its mapping goes. */
export function dropBindingKey(binding: FormDataBinding, key: string): FormDataBinding {
  if (!(key in binding.fields)) return binding
  const fields = { ...binding.fields }
  delete fields[key]
  return { ...binding, fields }
}

/** Params the reference inputs read ({{param.x}}). */
function inputParams(inputs: Record<string, string> | undefined): string[] {
  const out = new Set<string>()
  for (const template of Object.values(inputs ?? {})) for (const m of template.matchAll(/\{\{\s*param\.([A-Za-z0-9_]+)\s*\}\}/g)) out.add(m[1])
  return [...out]
}

/**
 * The rules a binding manages (BINDING_RULE_IDS). `context`: the form's
 * declared parameter names (a load / update rule needs its row parameter
 * declared). Read-only fields are written back with the value they loaded
 * (the rule action keeps a read-only field's stored value).
 */
export function bindingRules(binding: FormDataBinding | undefined, context: { params: Iterable<string> }): FormRule[] {
  if (!binding) return []
  const entries = Object.entries(binding.fields)
  if (!entries.length) return []
  const params = new Set(context.params)
  const name = binding.label ? `"${binding.label}"` : binding.kind === 'table' ? 'the data table' : 'the API reference'
  const description = 'Managed by Data binding (the designer\'s Data panel): regenerated from the binding, so change the binding, not this rule.'
  const outputs = entries.map(([key, source]) => ({ path: source, to: key }))
  const rules: FormRule[] = []
  if (binding.kind === 'reference') {
    const used = inputParams(binding.inputs).filter((p) => params.has(p))
    rules.push({
      id: BINDING_RULE_IDS.load, name: `Load from ${name}`, description, event: 'form_load',
      ...(used.length ? { if: { match: 'all', conditions: used.map((p) => ({ column: `param.${p}`, operator: 'is_set' as const })) } } : {}),
      then: [{ type: 'call_reference', reference_id: binding.source_id, ...(binding.integration_id ? { integration_id: binding.integration_id } : {}), ...(binding.inputs ? { inputs: { ...binding.inputs } } : {}), outputs, on_error: 'ignore' }],
    })
    return rules
  }
  const param = binding.record_param && params.has(binding.record_param) ? binding.record_param : null
  const rowId = param ? `{{param.${param}}}` : ''
  if (param) {
    rules.push({
      id: BINDING_RULE_IDS.load, name: `Load the row from ${name}`, description, event: 'form_load',
      if: { match: 'all', conditions: [{ column: `param.${param}`, operator: 'is_set' }] },
      then: [{ type: 'table_read', table_id: binding.source_id, row_id: rowId, outputs }],
    })
  }
  if (binding.save) {
    const columnValues = Object.fromEntries(entries.filter(([, source]) => source !== 'row_id').map(([key, source]) => [source, `{{${key}}}`]))
    if (Object.keys(columnValues).length) {
      if (param) {
        rules.push({
          id: BINDING_RULE_IDS.update, name: `Save the row to ${name}`, description, event: 'before_submit',
          if: { match: 'all', conditions: [{ column: `param.${param}`, operator: 'is_set' }] },
          then: [{ type: 'table_update', table_id: binding.source_id, row_id: rowId, column_values: columnValues }],
        })
      }
      rules.push({
        id: BINDING_RULE_IDS.create, name: `Add a row to ${name}`, description, event: 'before_submit',
        ...(param ? { if: { match: 'all', conditions: [{ column: `param.${param}`, operator: 'is_not_set' }] } } : {}),
        then: [{ type: 'table_create', table_id: binding.source_id, column_values: columnValues }],
      })
    }
  }
  return rules
}

/** The form's rules with the binding's managed rules regenerated (hand-made rules first, untouched). */
export function withBindingRules(rules: FormRule[], binding: FormDataBinding | undefined, context: { params: Iterable<string> }): FormRule[] {
  return [...rules.filter((r) => !isBindingRuleId(r.id)), ...bindingRules(binding, context)]
}

/** What the designer's settings say about a binding's reads and writes (plain words). */
export function bindingCapabilities(binding: Pick<FormDataBinding, 'kind' | 'record_param' | 'save'>): { loads: string; saves: string; writable: boolean } {
  if (binding.kind === 'reference') {
    return { loads: 'When the form opens, the API reference is called and its response fills the bound fields.', saves: 'Read only: submissions are stored by UserTasks; API references are never called to save them.', writable: false }
  }
  const loads = binding.record_param ? `When the form opens with a row id in the "${binding.record_param}" parameter, that row fills the bound fields.` : 'Nothing loads (choose a row id parameter to load a row).'
  const saves = binding.save ? (binding.record_param ? 'On submit, the row is updated (or a new row added when no row id is given), with your own data rights.' : 'On submit, a new row is added, with your own data rights.') : 'Read only: the table is not written.'
  return { loads, saves, writable: Boolean(binding.save) }
}
