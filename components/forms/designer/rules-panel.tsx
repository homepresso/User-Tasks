'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow / reference option rows are free-form JSON */

import { surveyConditionSubjects } from '@/lib/forms/survey/controls'
import { AnonymousStepToggle } from './anonymous-step-toggle'
import { CallReferenceEditor } from './call-reference-editor'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, FlaskConical, GripVertical, Plus, Search, Trash2, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import type { DesignerState } from '@/lib/forms/designer-state'
import { designerRuleProblems } from '@/lib/forms/designer-state'
import type { FormLayout } from '@/lib/forms/layout'
import { isPaged } from '@/lib/forms/layout'
import { FORM_ACTION_LABELS, allowedActions, type FormAction, type FormActionType, type FormButton } from '@/lib/forms/buttons'
import { loadableTargets } from '@/lib/forms/lazy-load'
import { CallReferenceExtras, TableActionEditor } from './data-action-editor'
import { ConfirmTextEditor, EditRowEditor, RowActionEditor, RowTargetEditor } from './list-action-editor'
import { ROW_ACTION_TYPES, RULE_ONLY_ACTION_TYPES, listClearFields, type RowActionType, listSourceField, type FieldButtonAction, type FieldButtonActionType, type RuleOnlyActionType } from '@/lib/forms/field-buttons'
import { FORM_TARGET_LABELS, FORM_WHOLE_TARGET } from '@/lib/forms/form-state'
import {
  AFTER_SUBMIT_ACTIONS, ALWAYS_ACTIONS, EVENT_CONTEXT, EVENT_TARGET, FORM_RULE_EVENTS, FORM_RULE_EVENT_LABELS, RULE_ACTION_GROUPS, RULE_ACTION_LABELS,
  collectFormRules, conditionPaths, describeConditions, describeRuleAction, duplicateRule, moveNativeRule, newRuleId, removeUnifiedRule, ruleConflicts, ruleValue,
  promptIds, simulateRuleEvent, writeUnifiedRule,
  type FormRule, type FormRuleEventType, type RuleHome, type RulesDefinition, type UnifiedRule,
} from '@/lib/forms/form-rules'
import { lookupLabelKey } from '@/lib/forms/lookup'
import { DISPLAY_FIELD_TYPES, type TaskFieldType } from '@/lib/task-field-schema'
import { ActionEditor, newAction, targetOptions } from './button-properties'
import { BranchActions } from './message-editor'
import { DISMISSED_RESPONSE } from '@/lib/forms/form-messages'
import { GroupEditor } from './data-table-properties'
import { dataTableKeyColumn } from '@/lib/forms/data-table'
import { labelLoopWarnings } from '@/lib/forms/label-field'
import { BarActionEditor } from './form-settings'
import { useDesignerPreviewValues } from './designer-preview-context'
import { SetVariableEditor } from './set-variable-editor'
import { DesignerTestSampleProvider, DesignerVariableScope } from './designer-variable-scope'
import { AFTER_SUBMIT_VARIABLES, type FormVariableContext } from '@/lib/forms/variable-catalog'
import { CONTROLS_KEY, contextVariableOptions, layoutFormParams, withFormContext } from '@/lib/forms/form-params'
import { prefillRuleTemplate } from '@/lib/forms/reference-results'
import { RULE_VARIABLE_TYPE_LABELS, controlState, controlVariables, enrichEventContext, eventVariables, ruleVariableOptions, withControlState } from '@/lib/forms/rule-variables'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * The form designer's Rules tab: every rule of the form in one list —
 * the form's own rules (layout.rules) and the ones that live elsewhere
 * (Visible when, Disabled when, Button On click, the bar buttons'
 * behaviours, start-hidden targets), each with a "where it lives" badge.
 * Each rule reads When [event] → If [conditions] → Then [actions].
 * Editing writes back to where the rule lives (lib/forms/form-rules.ts
 * writeUnifiedRule); an edit that no longer fits there moves the rule here.
 * Own rules run in list order (drag, or the arrows, to reorder); a note
 * flags rules that set the same thing; each rule can be turned off, renamed,
 * duplicated and deleted; search / filter by event or field; the test panel
 * simulates an event (a sample row, a value) and lists what would run.
 */


const EVENT_ROW_NOUN: Partial<Record<FormRuleEventType, string>> = {
  row_click: 'Clicked row', row_select: 'Selected row', row_deselect: 'Deselected row', row_double_click: 'Double-clicked row', cell_edit: 'Edited row', row_add: 'New row', row_delete: 'Deleted row',
}

const EVENT_GROUPS: Array<{ label: string; events: FormRuleEventType[] }> = [
  { label: 'Form', events: ['always', 'form_load', 'page_change', 'flag_change', 'before_submit', 'after_submit', 'message_answered', 'section_change', 'part_loaded'] },
  { label: 'Fields', events: ['value_change', 'focus', 'blur', 'item_select', 'button_click'] },
  { label: 'Data table', events: ['row_click', 'row_select', 'row_deselect', 'row_double_click', 'cell_edit', 'row_add', 'row_delete'] },
]

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-semibold text-fg-muted">{children}</label>
}

function toDef(state: DesignerState): RulesDefinition {
  return { fields: state.fields as unknown as RulesDefinition['fields'], layout: state.layout as unknown as RulesDefinition['layout'], buttons: state.buttons as unknown as RulesDefinition['buttons'] }
}

function fromDef(state: DesignerState, def: RulesDefinition): DesignerState {
  return { ...state, fields: def.fields as unknown as DesignerState['fields'], layout: def.layout as unknown as FormLayout, buttons: (def.buttons ?? state.buttons) as unknown as FormButton[] }
}

/** Subjects a condition may test, and placeholders actions may use, for this rule's event. */
function scopeOptions(state: DesignerState, rule: FormRule) {
  const valueFields = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type))
  const flags = (state.layout.state?.flags ?? []).map((f) => f.key)
  const subjects: Array<{ value: string; label: string; hint?: string }> = [
    ...valueFields.flatMap((f) => [
      { value: f.key, label: f.label || f.key, hint: 'field' },
      ...(f.type === 'lookup' ? [{ value: lookupLabelKey(f.key), label: `${f.label || f.key} (display label)`, hint: 'field' }] : []),
      // A matrix's statements, one subject each (lib/forms/survey/controls.ts).
      ...surveyConditionSubjects(f).map((s) => ({ ...s, hint: 'field' })),
    ]),
    ...flags.map((f) => ({ value: `state.${f}`, label: `state.${f}`, hint: 'flag' })),
    // Sections (lib/forms/sections.ts): included (optional ones) / visible.
    ...(state.layout.sections ?? []).flatMap((s) => [
      ...(s.optional ? [{ value: `section.${s.key}.included`, label: `Section ${s.title || s.key} is included`, hint: 'section' }] : []),
      { value: `section.${s.key}.visible`, label: `Section ${s.title || s.key} is visible`, hint: 'section' },
      { value: `section.${s.key}.loaded`, label: `Section ${s.title || s.key} has loaded`, hint: 'section' },
    ]),
    // When to load (lib/forms/lazy-load.ts): a step / tab has loaded.
    ...(isPaged(state.layout) ? state.layout.pages.map((p) => ({ value: `step.${p.id}.loaded`, label: `Step / tab ${p.title} has loaded`, hint: 'section' })) : []),
    { value: 'user.email', label: 'Current user: email', hint: 'user' },
    { value: 'user.name', label: 'Current user: name', hint: 'user' },
    { value: 'user.id', label: 'Current user: id', hint: 'user' },
  ]
  const eventPaths = [...EVENT_CONTEXT[rule.event].filter((p) => p !== 'event.row' && p !== 'event.item.fields')]
  const table = EVENT_TARGET[rule.event] === 'table' && rule.target ? state.fields.find((f) => f.key === rule.target) : null
  for (const col of table?.data_table?.columns ?? []) eventPaths.push(`event.row.${col.key}`)
  const lookup = rule.event === 'item_select' && rule.target ? state.fields.find((f) => f.key === rule.target) : null
  for (const col of lookup?.lookup ? [...(lookup.lookup.display_columns ?? lookup.lookup.display_fields ?? []), ...(lookup.lookup.fill ?? []).map((f) => f.from)] : []) eventPaths.push(`event.item.fields.${col}`)
  // This event: exactly what the runtime puts on {{event.*}} for this rule's When (lib/forms/rule-variables.ts), typed.
  const eventVars = eventVariables(rule.event, rule.target, state.fields as never)
  for (const v of eventVars) subjects.push({ value: v.path, label: `${v.label} · ${RULE_VARIABLE_TYPE_LABELS[v.type]}`, hint: 'event' })
  for (const v of eventVars) if (v.path.startsWith('event.item.') && v.path !== 'event.item') eventPaths.push(v.path)
  // Controls: the live state of the form's tables, autocompletes and steps, from any rule.
  for (const o of ruleVariableOptions(controlVariables(state.fields as never, isPaged(state.layout) ? state.layout.pages : [], state.layout.sections ?? []))) subjects.push({ value: o.name, label: o.label, hint: 'control' })
  // Parameters and variables (lib/forms/form-params.ts): conditions test them, actions read them.
  for (const o of contextVariableOptions(state.layout)) subjects.push({ value: o.name, label: o.label, hint: o.group === 'Parameters' ? 'parameter' : 'variable' })
  const GROUPS: Record<string, string> = { event: 'This event', user: 'Current user', parameter: 'Parameters', variable: 'Variables', control: 'Controls', flag: 'Flags' }
  const placeholders = subjects.filter((s) => s.hint !== 'field').map((s) => ({ name: s.value, group: GROUPS[s.hint ?? 'flag'] ?? 'Flags', label: s.label }))
  return { subjects, placeholders, eventPaths, table }
}

function targetChoices(state: DesignerState, event: FormRuleEventType): Array<{ value: string; label: string }> {
  const kind = EVENT_TARGET[event]
  const of = (pred: (t: TaskFieldType) => boolean) => state.fields.filter((f) => pred(f.type)).map((f) => ({ value: f.key, label: f.label || f.key }))
  switch (kind) {
    case 'field': return of((t) => !DISPLAY_FIELD_TYPES.has(t))
    case 'button': return of((t) => t === 'button')
    case 'table': return of((t) => t === 'data_table')
    case 'list': return of((t) => t === 'list')
    case 'rows': return state.fields.filter((f) => f.type === 'list' || (f.type === 'data_table' && f.data_table?.mode === 'edit')).map((f) => ({ value: f.key, label: f.label || f.key }))
    case 'lookup': return of((t) => t === 'lookup')
    case 'label': return of((t) => t === 'label')
    case 'page': return isPaged(state.layout) ? state.layout.pages.map((p) => ({ value: p.id, label: p.title })) : []
    case 'flag': return (state.layout.state?.flags ?? []).map((f) => ({ value: f.key, label: `state.${f.key}` }))
    case 'bar_button': return state.buttons.filter((b) => b.kind === 'submit' || b.kind === 'outcome').map((b) => ({ value: b.id, label: b.label }))
    case 'message': return promptIds(toDef(state)).map((id) => ({ value: id, label: id }))
    case 'section': return (state.layout.sections ?? []).filter((s) => s.optional).map((s) => ({ value: s.key, label: s.title || s.key }))
    case 'part': return loadableTargets(state.layout).filter((t) => t.load !== 'eager').map((t) => ({ value: t.target, label: `${t.kind === 'page' ? 'Step / tab' : 'Section'}: ${t.label}` }))
    default: return []
  }
}

function actionAllowed(event: FormRuleEventType, type: FieldButtonActionType, paged: boolean): boolean {
  if (event === 'always') return ALWAYS_ACTIONS.has(type)
  if (event === 'after_submit') return AFTER_SUBMIT_ACTIONS.has(type)
  if (!paged && (type === 'go_to_page' || type === 'next_page' || type === 'previous_page')) return false
  return true
}

/* ── Rule-only action editors ───────────────────────────────────────── */

function RuleOnlyActionEditor({ action, index, count, state, rule, onChange, onMove, onRemove, placeholders, eventPaths, renderBranch }: {
  /** A server step's own on-success / on-failure steps (top-level steps only; one level). */
  renderBranch?: (actions: FieldButtonAction[], onChange: (next: FieldButtonAction[], tag?: string) => void) => React.ReactNode
  action: FieldButtonAction
  index: number
  count: number
  state: DesignerState
  rule: FormRule
  onChange: (next: FieldButtonAction, tag?: string) => void
  onMove: (delta: number) => void
  onRemove: () => void
  placeholders: Array<{ name: string; group: string; label?: string }>
  eventPaths: string[]
}) {
  const label = RULE_ACTION_LABELS[action.type]
  // Rules may write read-only fields too (Copy values); the server keeps such a value only when a rule could produce it.
  const valueFields = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => (f.read_only ? { ...f, label: `${f.label || f.key} (read-only)` } : f))
  const allFieldOptions = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => ({ value: f.key, label: f.label || f.key }))
  const formPlaceholders = [...valueFields.map((f) => ({ name: f.key, group: 'This form', label: f.label || f.key })), ...placeholders]
  const { data: workflows = [] } = useQuery({
    queryKey: ['form-button-workflows'], enabled: action.type === 'start_workflow', staleTime: 60_000,
    queryFn: async () => ((await serverRead('automations.workflowOptions')).data ?? []) as any[],
  })
  const { data: references = [] } = useQuery({
    queryKey: ['forms-lookup-references'], enabled: action.type === 'call_reference', staleTime: 60_000,
    queryFn: async () => ((await serverRead('integrations.references')).data ?? []) as any[],
  })
  const rowPaths = eventPaths.filter((p) => p.startsWith('event.row.') || p.startsWith('event.item.fields.'))
  return (
    <div className="space-y-1.5 rounded border p-2 border-border" data-rule-action={action.type}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-2xs font-semibold">{index + 1}. {label}</p>
        <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === 0} aria-label={`Move ${label} earlier`} onClick={() => onMove(-1)}><ArrowUp size={11} /></button>
        <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === count - 1} aria-label={`Move ${label} later`} onClick={() => onMove(1)}><ArrowDown size={11} /></button>
        <button type="button" className="rounded p-0.5" aria-label={`Remove ${label}`} onClick={onRemove}><X size={11} /></button>
      </div>
      {action.type === 'enable_disable' && (() => {
        const options = targetOptions(state, '').filter((o) => o.kind !== 'page')
        const chosen = action.targets ?? []
        return (
          <>
            <div className="flex gap-1" role="radiogroup" aria-label="Enable or disable">
              {([['disable', 'Disable'], ['enable', 'Enable'], ['toggle', 'Toggle']] as const).map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={(action.mode ?? 'toggle') === v} onClick={() => onChange({ ...action, mode: v })}
                  className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', (action.mode ?? 'toggle') === v ? 'border-primary' : 'border-border', (action.mode ?? 'toggle') === v ? 'bg-primary-wash' : '', (action.mode ?? 'toggle') === v ? 'text-primary-text' : '')}
                 >{t}</button>
              ))}
            </div>
            <AutocompleteSelect value="" placeholder="+ Add a field, section or row…" options={options.filter((o) => !chosen.includes(o.target)).map((o) => ({ value: o.target, label: o.label, hint: FORM_TARGET_LABELS[o.kind] }))}
              onChange={(v) => { if (v) onChange({ ...action, targets: [...chosen, v] }) }} />
            <ul className="space-y-1">
              {chosen.map((t) => (
                <li key={t} className="flex items-center gap-1 text-2xs"><span className="flex-1 truncate">{options.find((o) => o.target === t)?.label ?? t}</span>
                  <button type="button" className="rounded p-0.5" aria-label={`Remove ${t}`} onClick={() => onChange({ ...action, targets: chosen.filter((x) => x !== t) })}><X size={10} /></button></li>
              ))}
            </ul>
            <p className="text-2xs text-fg-muted">{rule.event === 'always' ? 'Applied while the condition holds, undone when it doesn’t.' : 'A disabled field keeps its value; it is presentation only (use Read-only on the field for a server guarantee).'}</p>
          </>
        )
      })()}
      {action.type === 'read_only' && (() => {
        // Controls (not buttons or display elements), sections, rows, steps / tabs and the whole form.
        const noValue = new Set(state.fields.filter((f) => f.type === 'button' || f.type === 'divider' || f.type === 'label' || f.type === 'heading').map((f) => `field:${f.key}`))
        const options = [
          { target: FORM_WHOLE_TARGET, label: 'Whole form', hint: 'Form' },
          ...targetOptions(state, '').filter((o) => !noValue.has(o.target)).map((o) => ({ target: o.target, label: o.label, hint: FORM_TARGET_LABELS[o.kind] })),
        ]
        const chosen = action.targets ?? []
        const mode = action.mode === 'read_only' || action.mode === 'editable' ? action.mode : 'toggle'
        return (
          <>
            <div className="flex gap-1" role="radiogroup" aria-label="Read only or editable">
              {([['read_only', 'Read only'], ['editable', 'Editable'], ['toggle', 'Toggle']] as const).map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => onChange({ ...action, mode: v })}
                  className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', mode === v ? 'border-primary bg-primary-wash text-primary-text' : 'border-border')}
                 >{t}</button>
              ))}
            </div>
            <AutocompleteSelect value="" placeholder="+ Add a control, section, step / tab or the whole form…" options={options.filter((o) => !chosen.includes(o.target)).map((o) => ({ value: o.target, label: o.label, hint: o.hint }))}
              onChange={(v) => { if (v) onChange({ ...action, targets: [...chosen, v] }) }} />
            <ul className="space-y-1">
              {chosen.map((t) => (
                <li key={t} className="flex items-center gap-1 text-2xs" data-target={t}><span className="flex-1 truncate">{options.find((o) => o.target === t)?.label ?? `${t} (missing)`}</span>
                  <button type="button" className="rounded p-0.5" aria-label={`Remove ${options.find((o) => o.target === t)?.label ?? t}`} onClick={() => onChange({ ...action, targets: chosen.filter((x) => x !== t) })}><X size={10} /></button></li>
              ))}
            </ul>
            <p className="text-2xs text-fg-muted">
              {rule.event === 'always' ? 'Read only while the condition holds, editable again when it doesn’t. ' : ''}
              A read-only control shows its value and still submits it, but can’t be changed (rules still can); it isn’t required. A section, step / tab or the whole form covers every control in it. Buttons aren’t affected — use Enable / disable.
            </p>
          </>
        )
      })()}
      {action.type === 'collapse_expand' && (() => {
        const sections = state.layout.sections ?? []
        const chosen = action.targets ?? []
        return (
          <>
            <div className="flex gap-1" role="radiogroup" aria-label="Collapse or expand">
              {([['collapse', 'Collapse'], ['expand', 'Expand'], ['toggle', 'Toggle']] as const).map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={(action.mode ?? 'toggle') === v} onClick={() => onChange({ ...action, mode: v })}
                  className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', (action.mode ?? 'toggle') === v ? 'border-primary' : 'border-border', (action.mode ?? 'toggle') === v ? 'bg-primary-wash' : '', (action.mode ?? 'toggle') === v ? 'text-primary-text' : '')}
                 >{t}</button>
              ))}
            </div>
            <AutocompleteSelect value="" placeholder={sections.length ? '+ Add a section…' : 'Add a section to the form first'} options={sections.filter((s) => !chosen.includes(`section:${s.key}`)).map((s) => ({ value: `section:${s.key}`, label: s.title || s.key, hint: s.collapsible ? 'collapsible' : 'not collapsible' }))}
              onChange={(v) => { if (v) onChange({ ...action, targets: [...chosen, v] }) }} />
            <ul className="space-y-1">
              {chosen.map((t) => (
                <li key={t} className="flex items-center gap-1 text-2xs"><span className="flex-1 truncate">{sections.find((s) => `section:${s.key}` === t)?.title ?? t}</span>
                  <button type="button" className="rounded p-0.5" aria-label={`Remove ${t}`} onClick={() => onChange({ ...action, targets: chosen.filter((x) => x !== t) })}><X size={10} /></button></li>
              ))}
            </ul>
            <p className="text-2xs text-fg-muted">Presentation only: a collapsed section&apos;s required fields stay required (it opens on an error).</p>
          </>
        )
      })()}
      {action.type === 'load_part' && (() => {
        const parts = loadableTargets(state.layout)
        const chosen = action.targets ?? []
        const kindLabel = (k: 'page' | 'section') => (k === 'page' ? 'Step / tab' : 'Section')
        const loadLabel = { eager: 'loads on open', visible: 'when first shown', rule: 'when a rule loads it' } as const
        return (
          <>
            <AutocompleteSelect value="" placeholder={parts.length ? '+ Add a section, step or tab…' : 'Add a section, step or tab to the form first'}
              options={parts.filter((p) => !chosen.includes(p.target)).map((p) => ({ value: p.target, label: `${kindLabel(p.kind)}: ${p.label}`, hint: loadLabel[p.load] }))}
              onChange={(v) => { if (v) onChange({ ...action, targets: [...chosen, v] }) }} />
            <ul className="space-y-1">
              {chosen.map((t) => {
                const p = parts.find((x) => x.target === t)
                return (
                  <li key={t} className="flex items-center gap-1 text-2xs"><span className="flex-1 truncate">{p ? `${kindLabel(p.kind)}: ${p.label}` : t}</span>
                    <button type="button" className="rounded p-0.5" aria-label={`Remove ${t}`} onClick={() => onChange({ ...action, targets: chosen.filter((x) => x !== t) })}><X size={10} /></button></li>
                )
              })}
            </ul>
            <p className="text-2xs text-fg-muted">Mounts the part&apos;s controls and starts their queries (once; a loaded part stays loaded). Parts that load on open are already loaded.</p>
          </>
        )
      })()}
      {(action.type === 'field_error' || action.type === 'block_submit') && (
        <>
          <AutocompleteSelect value={action.field ?? ''} placeholder={action.type === 'field_error' ? 'Field the error shows on…' : 'Show it on a field (optional)'} clearable={action.type === 'block_submit'}
            options={allFieldOptions} onChange={(v) => onChange({ ...action, field: v || undefined })} />
          <VariableInput value={action.text ?? ''} extraVariables={formPlaceholders} placeholder={action.type === 'field_error' ? 'End date must be after the start date' : 'Add at least one line before submitting'}
            onChange={(v) => onChange({ ...action, text: v }, 'rule-error-text')} />
          <p className="text-2xs text-fg-muted">
            {['always', 'before_submit', 'value_change', 'blur'].includes(rule.event)
              ? 'Checked again on the server at submit (conditions on form values and flags), so it cannot be skipped.'
              : 'Shown in the browser when the event happens (row and item events cannot be re-checked by the server).'}
          </p>
        </>
      )}
      {action.type === 'copy_values' && (
        <div className="space-y-1">
          {Object.entries(action.assign ?? {}).map(([key, template]) => (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center gap-1">
                <p className="flex-1 text-2xs font-medium">{valueFields.find((f) => f.key === key)?.label ?? key} ←</p>
                <button type="button" className="rounded p-0.5" aria-label={`Stop copying into ${key}`} onClick={() => { const next = { ...(action.assign ?? {}) }; delete next[key]; onChange({ ...action, assign: next }) }}><X size={10} /></button>
              </div>
              {rowPaths.length > 0 && (
                <AutocompleteSelect value={/^\{\{(event\.[\w.]+)\}\}$/.exec(template)?.[1] ?? ''} placeholder="From the row / item…" options={rowPaths.map((p) => ({ value: p, label: p.replace(/^event\.(row|item\.fields)\./, ''), hint: p.startsWith('event.row') ? 'row column' : 'item field' }))}
                  onChange={(v) => onChange({ ...action, assign: { ...(action.assign ?? {}), [key]: v ? `{{${v}}}` : '' } })} />
              )}
              <VariableInput value={template} extraVariables={formPlaceholders} placeholder="{{event.row.name}}, {{other_field}}"
                onChange={(v) => onChange({ ...action, assign: { ...(action.assign ?? {}), [key]: v } }, `copy-${key}`)} />
            </div>
          ))}
          <AutocompleteSelect value="" placeholder="+ Copy into a field…" options={valueFields.filter((f) => !(f.key in (action.assign ?? {}))).map((f) => ({ value: f.key, label: f.label || f.key }))}
            onChange={(v) => {
              if (!v) return
              const guess = rowPaths.find((p) => p.split('.').pop() === v || p.split('.').pop() === v.replace(/^[a-z]+_/, ''))
              onChange({ ...action, assign: { ...(action.assign ?? {}), [v]: guess ? `{{${guess}}}` : '' } })
            }} />
        </div>
      )}
      {(action.type === 'refresh' || action.type === 'run_lookup') && (
        <>
          <AutocompleteSelect value={action.field ?? ''} placeholder={action.type === 'refresh' ? 'Data table or autocomplete…' : 'Autocomplete…'}
            options={state.fields.filter((f) => (action.type === 'refresh' ? f.type === 'data_table' || f.type === 'lookup' : f.type === 'lookup')).map((f) => ({ value: f.key, label: f.label || f.key }))}
            onChange={(v) => onChange({ ...action, field: v || undefined })} />
          {action.type === 'run_lookup' && (
            <>
              <VariableInput value={action.query ?? ''} extraVariables={formPlaceholders} placeholder="Search text, e.g. {{event.row.customer_id}}" onChange={(v) => onChange({ ...action, query: v || undefined }, 'lookup-query')} />
              <p className="text-2xs text-fg-muted">Runs the autocomplete&apos;s own lookup (its source, filters and permissions) and selects the first match — its fill-ins apply too.</p>
            </>
          )}
        </>
      )}
      {ROW_ACTION_TYPES.includes(action.type as RowActionType) && <RowActionEditor action={action} state={state} placeholders={formPlaceholders} onChange={onChange} />}
      {(action.type === 'commit_row' || action.type === 'delete_row') && action.commit_mode === 'save_now' && (
        <AnonymousStepToggle checked={action.allow_anonymous === true} onChange={(v) => onChange({ ...action, allow_anonymous: v || undefined })} />
      )}
      {(action.type === 'edit_list_row' || action.type === 'cancel_list_edit') && <EditRowEditor action={action} state={state} placeholders={formPlaceholders} onChange={onChange} />}
      {action.type === 'update_list_row' && (() => {
        const lists = state.fields.filter((f) => f.type === 'list')
        const list = lists.find((f) => f.key === action.list_field)
        const values = action.values ?? {}
        return (
          <>
            <AutocompleteSelect value={action.list_field ?? ''} placeholder="Which List…" options={lists.map((f) => ({ value: f.key, label: f.label || f.key }))} onChange={(v) => onChange({ ...action, list_field: v || undefined })} />
            <RowTargetEditor action={action} state={state} placeholders={formPlaceholders} onChange={onChange} fallback="last" />
            {(list?.list?.columns ?? []).filter((c) => c.type !== 'calculated').map((c) => (
              <div key={c.key} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-1 text-2xs">
                <span className="truncate">{c.label}</span>
                <VariableInput value={values[c.key] ?? ''} extraVariables={formPlaceholders} placeholder="{{result.row_id}}, {{form.x}} — empty: unchanged" ariaLabel={`New ${c.label}`}
                  onChange={(v) => { const next = { ...values }; if (v) next[c.key] = v; else delete next[c.key]; onChange({ ...action, values: next }, `list-up-${c.key}`) }} />
              </div>
            ))}
          </>
        )
      })()}
      {(action.type === 'add_list_row' || action.type === 'remove_list_row' || action.type === 'clear_list') && (() => {
        // List fields (lib/forms/list-field.ts): the list, then (Add row) each column's value from the form's inputs.
        const lists = state.fields.filter((f) => f.type === 'list')
        const list = lists.find((f) => f.key === action.list_field)
        const columns = (list?.list?.columns ?? []).filter((c) => c.type !== 'calculated')
        const inputs = valueFields.filter((f) => f.type !== 'list')
        const inputOptions = inputs.map((f) => ({ value: f.key, label: f.label || f.key }))
        const values = action.values ?? {}
        const clear = listClearFields(action)
        const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key])
        return (
          <>
            <AutocompleteSelect value={action.list_field ?? ''} placeholder={lists.length ? 'Which List…' : 'Add a List field to the form first'} options={lists.map((f) => ({ value: f.key, label: f.label || f.key }))}
              onChange={(v) => {
                if (action.type !== 'add_list_row') { onChange({ ...action, list_field: v || undefined }); return }
                // Guess each column's input: a field named like the column (<list>_<column>, <column>, …).
                const target = lists.find((f) => f.key === v)
                const guessed: Record<string, string> = {}
                for (const c of (target?.list?.columns ?? []).filter((c) => c.type !== 'calculated')) {
                  const match = inputs.find((f) => f.key === `${v}_${c.key}` || f.key === c.key || f.key.endsWith(`_${c.key}`))
                  if (match) guessed[c.key] = `{{${match.key}}}`
                }
                onChange({ ...action, list_field: v || undefined, values: Object.keys(values).length ? values : guessed })
              }} />
            {action.type === 'add_list_row' && list && (
              <div className="space-y-1" data-list-row-values>
                {columns.map((c) => (
                  <div key={c.key} className="space-y-0.5">
                    <p className="text-2xs font-medium">{c.label}{c.required ? ' *' : ''} ←</p>
                    <AutocompleteSelect value={listSourceField(values[c.key]) ?? ''} placeholder="From an input…" clearable options={inputOptions}
                      onChange={(v) => { const next = { ...values }; if (v) next[c.key] = `{{${v}}}`; else delete next[c.key]; onChange({ ...action, values: next }) }} />
                    {!listSourceField(values[c.key]) && (
                      <VariableInput value={values[c.key] ?? ''} extraVariables={formPlaceholders} placeholder="Or a value / {{expression}}"
                        onChange={(v) => { const next = { ...values }; if (v) next[c.key] = v; else delete next[c.key]; onChange({ ...action, values: next }, `list-val-${c.key}`) }} />
                    )}
                  </div>
                ))}
                <p className="pt-1 text-2xs font-medium">Must be filled in</p>
                <div className="flex flex-wrap gap-1">
                  {inputs.filter((f) => Object.values(values).some((t) => listSourceField(t) === f.key)).map((f) => (
                    <label key={f.key} className="flex items-center gap-1 text-2xs">
                      <input type="checkbox" className="accent-primary" checked={(action.require ?? []).includes(f.key)} onChange={() => { const next = toggle(action.require ?? [], f.key); onChange({ ...action, require: next.length ? next : undefined }) }} />
                      {f.label || f.key}
                    </label>
                  ))}
                </div>
                <p className="pt-1 text-2xs font-medium">Clear after adding</p>
                <div className="flex flex-wrap gap-1">
                  {inputs.filter((f) => Object.values(values).some((t) => listSourceField(t) === f.key) || clear.includes(f.key)).map((f) => (
                    <label key={f.key} className="flex items-center gap-1 text-2xs">
                      <input type="checkbox" className="accent-primary" checked={clear.includes(f.key)} onChange={() => onChange({ ...action, clear_fields: toggle(clear, f.key) })} />
                      {f.label || f.key}
                    </label>
                  ))}
                </div>
                <p className="text-2xs text-fg-muted">The row is checked against the columns (required, types, bounds) and the list&apos;s maximum; problems show on the inputs and nothing is added.</p>
              </div>
            )}
            {action.type === 'remove_list_row' && <RowTargetEditor action={action} state={state} placeholders={formPlaceholders} onChange={onChange} fallback="last" />}
            {(action.type === 'remove_list_row' || action.type === 'clear_list') && <ConfirmTextEditor action={action} placeholders={formPlaceholders} onChange={onChange} />}
          </>
        )
      })()}
      {action.type === 'call_reference' && <CallReferenceEditor action={action} state={state} references={references} placeholders={formPlaceholders} onChange={onChange} />}
      {action.type === 'call_reference' && action.reference_id && <CallReferenceExtras action={action} state={state} placeholders={formPlaceholders} onChange={onChange} />}
      {(action.type === 'table_read' || action.type === 'table_list' || action.type === 'table_create' || action.type === 'table_update' || action.type === 'table_delete') && (
        <TableActionEditor action={action} state={state} placeholders={formPlaceholders} onChange={onChange} />
      )}
      {(action.type === 'table_read' || action.type === 'table_list' || action.type === 'table_create' || action.type === 'table_update' || action.type === 'table_delete') && (
        <AnonymousStepToggle checked={action.allow_anonymous === true} onChange={(v) => onChange({ ...action, allow_anonymous: v || undefined })} />
      )}
      {renderBranch && (action.type === 'call_reference' ? action.wait !== false : action.type.startsWith('table_') || action.type === 'commit_row' || action.type === 'delete_row') && (
        <div className="space-y-1.5" data-action-branches>
          <div className="rounded border border-border p-1.5" data-branch="success">
            <p className="text-2xs font-semibold text-fg-muted">When it works <span className="font-normal">— {'{{result.*}}'} is the result{action.type === 'commit_row' ? ' (the row; Save now: result.id)' : ''}</span></p>
            {renderBranch(action.on_success ?? [], (next, tag) => onChange({ ...action, on_success: next.length ? next : undefined }, tag))}
          </div>
          <div className="rounded border border-border p-1.5" data-branch="failure">
            <p className="text-2xs font-semibold text-fg-muted">If it fails <span className="font-normal">— {'{{error.message}}'} says why{action.type === 'commit_row' ? ' ({{error.errors.<column>}} per cell)' : ''}; the rule then stops</span></p>
            {renderBranch(action.on_failure ?? [], (next, tag) => onChange({ ...action, on_failure: next.length ? next : undefined }, tag))}
          </div>
        </div>
      )}
      {action.type === 'set_variable' && <SetVariableEditor action={action} layout={state.layout} rowPaths={rowPaths} placeholders={formPlaceholders} onChange={onChange} />}
      {action.type === 'start_workflow' && (() => {
        const wf = workflows.find((w) => String(w.id) === action.workflow_id)
        const inputs: string[] = Array.isArray(wf?.user_variables) ? wf.user_variables.map((v: any) => String(v?.name ?? '')).filter(Boolean) : []
        return (
          <>
            <AutocompleteSelect value={action.workflow_id ?? ''} placeholder="Choose a workflow…" options={workflows.map((w) => ({ value: String(w.id), label: String(w.name) }))}
              onChange={(v) => onChange({ ...action, workflow_id: v || undefined, workflow_name: workflows.find((w) => String(w.id) === v)?.name, inputs: undefined })} />
            {inputs.map((name) => (
              <div key={name}>
                <p className="font-mono text-2xs">{name}</p>
                <VariableInput value={action.inputs?.[name] ?? ''} extraVariables={formPlaceholders} placeholder="{{field}}"
                  onChange={(v) => { const next = { ...(action.inputs ?? {}) }; if (v) next[name] = v; else delete next[name]; onChange({ ...action, inputs: next }, `wf-in-${name}`) }} />
              </div>
            ))}
            <p className="text-2xs text-fg-muted">Starts on the server, queued, for the person filling in the form.</p>
          </>
        )
      })()}
      {(action.type === 'call_reference' || action.type === 'start_workflow') && (
        <AnonymousStepToggle checked={action.allow_anonymous === true} onChange={(v) => onChange({ ...action, allow_anonymous: v || undefined })} />
      )}
    </div>
  )
}

/* ── One rule ───────────────────────────────────────────────────────── */

function RuleEditor({ state, unified, onWrite, onChangeState, problem }: {
  state: DesignerState
  unified: UnifiedRule
  onWrite: (rule: FormRule, tag?: string) => void
  onChangeState: (next: DesignerState, tag?: string) => void
  problem?: string
}) {
  const rule = unified.rule
  const paged = isPaged(state.layout)
  const { subjects, placeholders, eventPaths } = scopeOptions(state, rule)
  const targets = targetChoices(state, rule.event)
  const kind = EVENT_TARGET[rule.event]
  const set = (patch: Partial<FormRule>, tag?: string) => onWrite({ ...rule, ...patch }, tag)
  const setActions = (then: FieldButtonAction[], tag?: string) => set({ then }, tag)
  const { data: workflows = [] } = useQuery({
    queryKey: ['form-button-workflows'], enabled: unified.home.kind === 'bar_button', staleTime: 60_000,
    queryFn: async () => ((await serverRead('automations.workflowOptions')).data ?? []) as any[],
  })

  if (unified.home.kind === 'bar_button') {
    const buttonId = unified.home.button
    const button = state.buttons.find((b) => b.id === buttonId)!
    const actions = button.actions ?? []
    const setBar = (next: FormAction[], tag?: string) => onChangeState({ ...state, buttons: state.buttons.map((b) => (b.id === buttonId ? { ...b, actions: next } : b)) }, tag)
    return (
      <DesignerVariableScope state={state} context={{ kind: 'bar' }} extras={AFTER_SUBMIT_VARIABLES}>
      <div className="space-y-2" data-rule-editor="bar">
        <p className="text-2xs text-fg-muted">When <strong>{button.label}</strong> submits the form, after the submission is stored (also editable in Buttons &amp; header):</p>
        {actions.map((a, i) => (
          <BarActionEditor key={i} action={a} workflows={workflows} fields={state.fields} placeholders={placeholders}
            onChange={(next, tag) => setBar(actions.map((x, j) => (j === i ? next : x)), tag ? `${tag}-${i}` : undefined)}
            onRemove={() => setBar(actions.filter((_, j) => j !== i))} />
        ))}
        <select aria-label="Add a behaviour" className={inputClass} value="" onChange={(e) => { const t = e.target.value as FormActionType; if (t) setBar([...actions, { type: t, ...(t === 'message' ? { text: 'Thank you.' } : t === 'success_screen' ? { title: 'Thank you' } : {}) }]) }}>
          <option value="">+ Add a behaviour…</option>
          {allowedActions(button.kind).map((t) => <option key={t} value={t}>{FORM_ACTION_LABELS[t]}</option>)}
        </select>
      </div>
      </DesignerVariableScope>
    )
  }

  return (
    <div className="space-y-3" data-rule-editor={rule.id}>
      {problem && <p role="alert" className="flex items-start gap-1 text-2xs text-danger"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{problem}</p>}
      <div>
        <Label htmlFor={`rule-name-${unified.key}`}>Name</Label>
        <input id={`rule-name-${unified.key}`} className={inputClass} value={rule.name ?? ''} placeholder="e.g. Fill customer from the clicked row" onChange={(e) => set({ name: e.target.value || undefined }, 'rule-name')} data-testid="rule-name" />
      </div>
      {(rule.description !== undefined || unified.home.kind === 'rules') && (
        <div>
          <Label htmlFor={`rule-notes-${unified.key}`}>Notes</Label>
          <textarea id={`rule-notes-${unified.key}`} rows={rule.description && rule.description.length > 120 ? 4 : 2} className={inputClass} value={rule.description ?? ''} placeholder="Why this rule exists, or what is left to do" onChange={(e) => set({ description: e.target.value || undefined }, 'rule-notes')} data-testid="rule-notes" />
        </div>
      )}
      <fieldset className="space-y-1.5 rounded-lg border p-2 border-border">
        <legend className="px-1 text-2xs font-semibold text-primary-text">When</legend>
        <select aria-label="Event" className={inputClass} value={rule.event} data-testid="rule-event"
          onChange={(e) => {
            const event = e.target.value as FormRuleEventType
            const keep = EVENT_TARGET[event] === kind ? rule.target : undefined
            const choices = targetChoices(state, event)
            const target = keep ?? (EVENT_TARGET[event] && EVENT_TARGET[event] !== 'bar_button' && EVENT_TARGET[event] !== 'page' && EVENT_TARGET[event] !== 'flag' && EVENT_TARGET[event] !== 'section' && EVENT_TARGET[event] !== 'part' ? choices[0]?.value : undefined)
            set({ event, target, then: rule.then.filter((a) => actionAllowed(event, a.type, paged)) })
          }}>
          {EVENT_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.events.map((ev) => <option key={ev} value={ev}>{FORM_RULE_EVENT_LABELS[ev]}</option>)}
            </optgroup>
          ))}
        </select>
        {kind && (
          <AutocompleteSelect value={rule.target ?? ''} placeholder={kind === 'bar_button' || kind === 'page' || kind === 'flag' || kind === 'section' || kind === 'part' ? 'Any' : 'Choose…'} clearable={kind === 'bar_button' || kind === 'page' || kind === 'flag' || kind === 'section' || kind === 'part'}
            options={targets} onChange={(v) => set({ target: v || undefined })} />
        )}
        {rule.event === 'before_submit' && (
          <label className="flex items-start gap-1.5 text-2xs" data-testid="rule-step-check">
            <input type="checkbox" className="mt-0.5 accent-primary" checked={Boolean(rule.step_check)} onChange={(e) => set({ step_check: e.target.checked || undefined })} />
            <span>Also check on this step<span className="block text-2xs text-fg-muted">Off: it runs when the form is submitted (an error on another step takes the person there). On: a step&apos;s Next checks it too, for this step&apos;s fields.</span></span>
          </label>
        )}
        <p className="text-2xs text-fg-muted" data-testid="rule-event-context">
          {eventVariables(rule.event, undefined, []).length > 0
            ? <>Use what this event carries{EVENT_TARGET[rule.event] === 'table' ? <> (e.g. <strong>{EVENT_ROW_NOUN[rule.event] ?? 'Row'} › ID</strong> and each column)</> : null} and every control&apos;s state: press <code className="font-mono">{'{x}'}</code> beside a text box, or type <code className="font-mono">{'{{'}</code>.</>
            : <>This event carries no values: read the form&apos;s controls (e.g. a table&apos;s selected row) with <code className="font-mono">{'{x}'}</code> beside a text box, or type <code className="font-mono">{'{{'}</code>.</>}
        </p>
      </fieldset>
      <fieldset className="space-y-1.5 rounded-lg border p-2 border-border">
        <legend className="px-1 text-2xs font-semibold text-primary-text">If</legend>
        {rule.if
          ? <DesignerVariableScope state={state} context={{ kind: 'rule', event: rule.event, target: rule.target, slot: 'condition' }}><GroupEditor group={rule.if} depth={0} columns={subjects} placeholders={placeholders} onChange={(next, tag) => set({ if: next }, tag ? `rule-if-${tag}` : undefined)} /></DesignerVariableScope>
          : (
            <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" disabled={!subjects.length}
              onClick={() => set({ if: { match: 'all', conditions: [{ column: subjects[0]?.value ?? '', operator: 'eq', value: '' }] } })} data-testid="rule-add-condition">
              <Plus size={11} /> Add a condition (otherwise: always)
            </button>
          )}
      </fieldset>
      <fieldset className="space-y-1.5 rounded-lg border p-2 border-border">
        <legend className="px-1 text-2xs font-semibold text-primary-text">Then</legend>
        {/* This rule's event, its table's columns, the controls… (lib/forms/variable-catalog.ts). */}
        <DesignerVariableScope state={state} context={{ kind: 'rule', event: rule.event, target: rule.target, slot: 'action' }}>
        {rule.then.map((action, i) => {
          const common = {
            index: i, count: rule.then.length, state,
            onChange: (next: FieldButtonAction, tag?: string) => setActions(rule.then.map((a, j) => (j === i ? next : a)), tag ? `${tag}-${i}` : undefined),
            onMove: (delta: number) => { const next = [...rule.then]; const [a] = next.splice(i, 1); next.splice(Math.max(0, Math.min(next.length, i + delta)), 0, a); setActions(next) },
            onRemove: () => setActions(rule.then.filter((_, j) => j !== i)),
          }
          // A data / API step's own steps: the same editors (no questions, one level).
          const stepBranch = (actions: FieldButtonAction[], setBranch: (next: FieldButtonAction[], tag?: string) => void) => (
            <BranchActions actions={actions} onChange={setBranch} create={(t) => newAction(t as FieldButtonActionType)}
              options={RULE_ACTION_GROUPS.map((g) => ({ group: g.label, items: g.types.filter((t) => t !== 'prompt' && actionAllowed(rule.event, t, paged)).map((t) => ({ value: t, label: RULE_ACTION_LABELS[t] })) })).filter((g) => g.items.length)}
              renderAction={(a, j, inner) => (RULE_ONLY_ACTION_TYPES.includes(a.type as RuleOnlyActionType)
                ? <RuleOnlyActionEditor key={j} {...inner} state={state} action={a} rule={rule} placeholders={[...placeholders, { name: 'result', group: 'This step', label: 'The result' }, { name: 'error.message', group: 'This step', label: 'Why it failed' }]} eventPaths={eventPaths} />
                : <ActionEditor key={j} {...inner} state={state} action={a} field={{ _id: '', key: '', label: 'rule', type: 'button' }} label={RULE_ACTION_LABELS[a.type]} extraPlaceholders={placeholders}
                    onToggleStartHidden={() => {}} onAddFlag={() => {}} />)} />
          )
          return RULE_ONLY_ACTION_TYPES.includes(action.type as RuleOnlyActionType)
            ? <RuleOnlyActionEditor key={i} {...common} action={action} rule={rule} placeholders={placeholders} eventPaths={eventPaths} renderBranch={stepBranch} />
            : <ActionEditor key={i} {...common} action={action} field={{ _id: '', key: '', label: 'rule', type: 'button' }} label={RULE_ACTION_LABELS[action.type]} extraPlaceholders={placeholders}
                renderBranch={(actions, setBranch) => (
                  <BranchActions actions={actions} onChange={setBranch} create={(t) => newAction(t as FieldButtonActionType)}
                    options={RULE_ACTION_GROUPS.map((g) => ({ group: g.label, items: g.types.filter((t) => t !== 'prompt' && actionAllowed(rule.event, t, paged)).map((t) => ({ value: t, label: RULE_ACTION_LABELS[t] })) })).filter((g) => g.items.length)}
                    renderAction={(a, j, inner) => (RULE_ONLY_ACTION_TYPES.includes(a.type as RuleOnlyActionType)
                      ? <RuleOnlyActionEditor key={j} {...inner} state={state} action={a} rule={rule} placeholders={placeholders} eventPaths={eventPaths} />
                      : <ActionEditor key={j} {...inner} state={state} action={a} field={{ _id: '', key: '', label: 'rule', type: 'button' }} label={RULE_ACTION_LABELS[a.type]} extraPlaceholders={placeholders}
                          onToggleStartHidden={() => {}} onAddFlag={(flag) => onChangeState({ ...state, layout: { ...state.layout, state: { ...(state.layout.state ?? {}), flags: [...(state.layout.state?.flags ?? []), { key: flag }] } } })} />)} />
                )}
                onToggleStartHidden={(target, hidden) => {
                  const current = new Set(state.layout.state?.hidden ?? [])
                  if (hidden) current.add(target); else current.delete(target)
                  onChangeState({ ...state, layout: { ...state.layout, state: { ...(state.layout.state ?? {}), hidden: [...current] } } })
                }}
                onAddFlag={(flag) => onChangeState({
                  ...state,
                  layout: {
                    ...state.layout,
                    state: { ...(state.layout.state ?? {}), flags: [...(state.layout.state?.flags ?? []), { key: flag }] },
                    rules: (state.layout.rules ?? []).map((r) => (r.id === rule.id ? { ...r, then: r.then.map((a, j) => (j === i ? { ...a, flag } : a)) } : r)),
                  },
                })} />
        })}
        </DesignerVariableScope>
        <select aria-label="Add an action" className={inputClass} value="" data-testid="rule-add-action"
          onChange={(e) => { const t = e.target.value as FieldButtonActionType; if (t) setActions([...rule.then, newAction(t)]) }}>
          <option value="">+ Add an action…</option>
          {RULE_ACTION_GROUPS.map((g) => {
            const types = g.types.filter((t) => actionAllowed(rule.event, t, paged))
            return types.length ? (
              <optgroup key={g.label} label={g.label}>
                {types.map((t) => <option key={t} value={t}>{RULE_ACTION_LABELS[t]}</option>)}
              </optgroup>
            ) : null
          })}
        </select>
        <p className="text-2xs text-fg-muted">
          {rule.event === 'always'
            ? '“Always” rules are declarative: their show / hide and enable / disable follow the condition; errors block submitting (checked on the server too).'
            : 'Actions run in order. Browser-only actions change what the person sees; API calls, workflows and table writes run on the server, from the saved form.'}
        </p>
      </fieldset>
    </div>
  )
}

/* ── Test panel ─────────────────────────────────────────────────────── */

/** The placeholders the triggered rules read, with what they resolve to for the sample (Test a rule). */
function ResolvedValues({ def, rules, scope }: { def: RulesDefinition; rules: string[]; scope: { values: Record<string, unknown>; event: Record<string, unknown> } }) {
  const wanted = new Set(rules)
  const paths = new Set<string>()
  for (const u of collectFormRules(def)) {
    if (!wanted.has(u.key)) continue
    const text = JSON.stringify({ if: u.rule.if, then: u.rule.then })
    for (const m of text.matchAll(/\{\{\s*([\w.\-[\]$]+)\s*\}\}/g)) paths.add(m[1])
    for (const p of conditionPaths(u.rule.if)) if (/^(event|control|param|var)\./.test(p)) paths.add(p)
  }
  const shown = [...paths].filter((p) => /^(event|control|param|var|user|state)\b/.test(p)).slice(0, 30)
  if (!shown.length) return null
  const text = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v))
  return (
    <div className="rounded border px-2 py-1 border-border" data-testid="rules-test-resolved">
      <p className="text-2xs font-semibold text-fg-muted">Resolved values</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-2xs">
        {shown.map((p) => (
          <div key={p} className="contents">
            <dt className="font-mono">{`{{${p}}}`}</dt>
            <dd className="truncate">{text(ruleValue(p, { values: scope.values, event: scope.event }))}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** What "Test a rule" simulates: chips in the rule editors show these values on hover. */
interface TestScope { type: FormRuleEventType; values: Record<string, unknown>; event: Record<string, unknown> }

function TestPanel({ state, def, onScope }: { state: DesignerState; def: RulesDefinition; onScope?: (scope: TestScope | null) => void }) {
  const preview = useDesignerPreviewValues()
  const [event, setEvent] = useState<FormRuleEventType>('row_click')
  const [target, setTarget] = useState('')
  const [sample, setSample] = useState('')
  const [response, setResponse] = useState('')
  const [controlsText, setControlsText] = useState('')
  const targets = targetChoices(state, event)
  // The answers the form's questions offer (Yes, No, custom values…), for "Answer questions with".
  const answers = new Map<string, string>()
  for (const u of collectFormRules(def)) for (const a of u.rule.then) if (a.type === 'prompt') for (const b of a.prompt?.buttons ?? []) if (!answers.has(b.value)) answers.set(b.value, b.label)
  const asks = answers.size > 0
  const table = EVENT_TARGET[event] === 'table' ? state.fields.find((f) => f.key === (target || targets[0]?.value)) : null
  const sampleTemplate = table ? JSON.stringify(Object.fromEntries((table.data_table?.columns ?? []).map((c) => [c.key, ''])), null, 1) : ''
  let context: Record<string, unknown> = {}
  let parseError = ''
  const text = sample || sampleTemplate
  if (EVENT_TARGET[event] === 'table') {
    try {
      const row = text ? JSON.parse(text) : {}
      // The row's key, as the table dispatches it ({{event.row_id}}).
      const keyColumn = table?.data_table ? dataTableKeyColumn(table.data_table) : ''
      context = { field: target || targets[0]?.value, row, ...(event !== 'row_add' && keyColumn && row && row[keyColumn] !== undefined ? { key: String(row[keyColumn]) } : {}) }
    } catch { parseError = 'The sample row is not valid JSON' }
  } else if (event === 'message_answered') context = { message: target || targets[0]?.value || null, response: text, label: text }
  else if (text) context = { field: target, value: text }
  // Sample control state ({{control.*}}): what the tables / autocompletes would hold.
  const pages = isPaged(state.layout) ? state.layout.pages : []
  const controlTemplate = JSON.stringify(Object.fromEntries(Object.entries(controlState(state.fields as never, preview ?? {}, pages, state.layout.sections ?? [])).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([p]) => !['selected_rows', 'selected_row'].includes(p)))])), null, 1)
  let controls: Record<string, unknown> = {}
  try { controls = (controlsText || controlTemplate) ? JSON.parse(controlsText || controlTemplate) : {} } catch { parseError = parseError || 'The control state is not valid JSON' }
  const enriched = enrichEventContext(event, context)
  const scopeValues = withControlState(state.fields as never, withFormContext(state.layout, { ...(preview ?? {}), [CONTROLS_KEY]: controls }), pages, state.layout.sections ?? [])
  // The reported parts as typed (a sample may set selected rows too).
  for (const [k, v] of Object.entries(controls)) if (v && typeof v === 'object') Object.assign(((scopeValues[CONTROLS_KEY] as Record<string, Record<string, unknown>>)[k] ??= {}), v)
  const results = parseError ? [] : simulateRuleEvent(def, { type: event, target: target || targets[0]?.value, context: enriched }, { values: scopeValues }, response ? { response } : {})
  const triggered = results.filter((r) => r.triggered)
  const scopeKey = parseError ? '' : JSON.stringify([event, enriched, scopeValues])
  useEffect(() => {
    onScope?.(scopeKey ? { type: event, values: scopeValues, event: enriched } : null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])
  useEffect(() => () => onScope?.(null), [onScope])
  return (
    <section className="space-y-2 rounded-lg border p-2 border-border" aria-label="Test a rule" data-testid="rules-test-panel">
      <p className="flex items-center gap-1 text-2xs font-semibold"><FlaskConical size={12} aria-hidden /> Test: simulate an event</p>
      <div className="grid grid-cols-2 gap-1">
        <select aria-label="Event to simulate" className={inputClass} value={event} onChange={(e) => { setEvent(e.target.value as FormRuleEventType); setTarget(''); setSample('') }}>
          {FORM_RULE_EVENTS.filter((e) => e !== 'always').map((ev) => <option key={ev} value={ev}>{FORM_RULE_EVENT_LABELS[ev]}</option>)}
        </select>
        {targets.length > 0 ? <AutocompleteSelect value={target || targets[0]?.value || ''} options={targets} onChange={setTarget} /> : <span />}
      </div>
      {asks && (
        <label className="flex items-center gap-1 text-2xs text-fg-muted">
          Answer questions with
          <select aria-label="Simulated answer" className={`${inputClass} flex-1`} value={response} onChange={(e) => setResponse(e.target.value)} data-testid="rules-test-response">
            <option value="">(show every answer)</option>
            {[...answers].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value={DISMISSED_RESPONSE}>Closed (Escape)</option>
          </select>
        </label>
      )}
      {(EVENT_TARGET[event] === 'table' || EVENT_TARGET[event] === 'field' || EVENT_TARGET[event] === 'lookup' || EVENT_TARGET[event] === 'label' || event === 'message_answered') && (
        <textarea aria-label={EVENT_TARGET[event] === 'table' ? 'Sample row (JSON)' : event === 'message_answered' ? 'Response (event.response)' : 'Sample value'} rows={EVENT_TARGET[event] === 'table' ? 4 : 1}
          className="w-full rounded-md border px-2 py-1 font-mono text-2xs" value={text} onChange={(e) => setSample(e.target.value)} data-testid="rules-test-sample" />
      )}
      <details className="text-2xs" data-testid="rules-test-controls">
        <summary className="cursor-pointer text-fg-muted">Control state (JSON) — {'{{control.<key>.*}}'}</summary>
        <textarea aria-label="Sample control state (JSON)" rows={5} className="mt-1 w-full rounded-md border px-2 py-1 font-mono text-2xs"
          value={controlsText || controlTemplate} onChange={(e) => setControlsText(e.target.value)} />
      </details>
      {parseError && <p className="text-2xs text-danger">{parseError}</p>}
      <p className="text-2xs text-fg-muted">Uses the Preview&apos;s current values. Nothing is saved or called.</p>
      <ResolvedValues def={def} rules={triggered.map((r) => r.key)} scope={{ values: scopeValues, event: enriched }} />
      <ul className="space-y-1" data-testid="rules-test-results">
        {!triggered.length && <li className="text-2xs text-fg-muted">No rule runs on this event.</li>}
        {triggered.map((r) => (
          <li key={r.key} className={cn('rounded border px-2 py-1 text-2xs', r.met ? 'border-primary' : 'border-border')} data-test-result={r.met ? 'runs' : 'skipped'}>
            <span className="font-semibold">{r.met ? '✓ Runs' : '✗ Conditions not met'}</span> · {r.name}
            {r.met && <ul className="ml-3 list-disc">{r.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ── The tab ────────────────────────────────────────────────────────── */

export function RulesPanel({ state, onChange }: {
  state: DesignerState
  onChange: (next: DesignerState, tag?: string) => void
}) {
  const def = useMemo(() => toDef(state), [state])
  const rules = useMemo(() => collectFormRules(def), [def])
  const conflicts = useMemo(() => ruleConflicts(def, rules), [def, rules])
  const problems = useMemo(() => designerRuleProblems(state), [state])
  // "Label changes" rules that go round in a loop (lib/forms/label-field.ts): warned, not blocked (the runtime caps them).
  const loops = useMemo(() => labelLoopWarnings(state.fields, state.layout), [state.fields, state.layout])
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [eventFilter, setEventFilter] = useState<string>('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [showTest, setShowTest] = useState(false)
  const [testScope, setTestScope] = useState<TestScope | null>(null)
  // Hovering a chip in a rule shows what the test panel's sample resolves it to.
  const testSample = useCallback((path: string, context: FormVariableContext): unknown => {
    if (!testScope) return undefined
    if ((path === 'event' || path.startsWith('event.')) && (context.kind !== 'rule' || context.event !== testScope.type)) return undefined
    const v = ruleValue(path, { values: testScope.values, event: testScope.event })
    return v === undefined ? undefined : v
  }, [testScope])

  const write = (home: RuleHome, rule: FormRule, tag?: string) => {
    const out = writeUnifiedRule(def, home, rule)
    onChange(fromDef(state, out.def), tag)
    if (out.home.kind === 'rules' && home.kind !== 'rules') setOpen(`rules:${out.home.id}`)
  }
  const addRule = () => {
    const id = newRuleId((state.layout.rules ?? []).map((r) => r.id))
    const rule: FormRule = { id, name: 'New rule', event: 'value_change', target: state.fields.find((f) => !DISPLAY_FIELD_TYPES.has(f.type))?.key, then: [] }
    onChange({ ...state, layout: { ...state.layout, rules: [...(state.layout.rules ?? []), rule] } })
    setOpen(`rules:${id}`)
  }
  // Template: "Prefill from a URL parameter via an API" (Form loads → If param is not empty → Call an API reference).
  const firstParam = layoutFormParams(state.layout)[0]
  const addPrefillRule = () => {
    if (!firstParam) return
    const id = newRuleId((state.layout.rules ?? []).map((r) => r.id))
    onChange({ ...state, layout: { ...state.layout, rules: [...(state.layout.rules ?? []), prefillRuleTemplate(firstParam, id)] } })
    setOpen(`rules:${id}`)
  }
  const nativeIds = (state.layout.rules ?? []).map((r) => r.id)

  const q = query.trim().toLowerCase()
  const shown = rules.filter((u) => {
    if (eventFilter && u.rule.event !== eventFilter) return false
    if (!q) return true
    const hay = [u.rule.name, u.badge, u.rule.target, FORM_RULE_EVENT_LABELS[u.rule.event], describeConditions(def, u.rule.if), ...u.rule.then.map((a) => describeRuleAction(def, a))].join(' ').toLowerCase()
    return hay.includes(q)
  })

  return (
    <DesignerTestSampleProvider value={showTest && testScope ? testSample : null}>
    <div className="space-y-3" data-testid="rules-panel">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-fg-muted">Every rule of this form — When [event] → If [conditions] → Then [actions]. Your own rules run in list order.</p>
        <button type="button" onClick={addRule} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium bg-primary text-primary-fg" data-testid="rules-new">
          <Plus size={12} aria-hidden /> New rule
        </button>
      </div>
      {firstParam && (
        <button type="button" onClick={addPrefillRule} className="flex items-center gap-1 text-2xs font-medium text-primary-text" data-testid="rules-new-prefill"
          title={`When the form loads, if {{param.${firstParam.name}}} is not empty, call an API reference and map its response into fields`}>
          <Plus size={11} aria-hidden /> Prefill from <code className="font-mono">{`{{param.${firstParam.name}}}`}</code> via an API (template)
        </button>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <div className="relative">
          <Search size={12} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input aria-label="Search rules" className={`${inputClass} pl-6`} placeholder="Search by name, field or action…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select aria-label="Filter by event" className={inputClass} value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
          <option value="">All events</option>
          {FORM_RULE_EVENTS.map((ev) => <option key={ev} value={ev}>{FORM_RULE_EVENT_LABELS[ev]}</option>)}
        </select>
      </div>

      {loops.map((w) => (
        <p key={w} role="status" className="flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-2xs border-warning text-fg" data-testid="rules-label-loop">
          <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0 text-warning" /> {w}
        </p>
      ))}
      {!rules.length && <p className="rounded-lg border border-dashed p-3 text-center text-2xs border-border text-fg-muted">No rules yet. Add one, or set “Visible when” on a field, or steps on a Button — they all show up here.</p>}
      <ol className="space-y-2" data-testid="rules-list">
        {shown.map((u) => {
          const isOpen = open === u.key
          const native = u.home.kind === 'rules'
          const index = native ? nativeIds.indexOf((u.home as { id: string }).id) : -1
          const problem = native ? problems[(u.home as { id: string }).id] : undefined
          const notes = conflicts.get(u.key) ?? []
          return (
            <li key={u.key}
              className={cn('rounded-lg border', problem ? 'border-danger' : isOpen ? 'border-primary' : 'border-border')}
              style={{ opacity: u.rule.disabled ? 0.6 : 1 }}
              draggable={native}
              onDragStart={(e) => { if (!native) return; setDragging(u.key); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { if (dragging && native) e.preventDefault() }}
              onDrop={(e) => {
                e.preventDefault()
                const from = rules.find((x) => x.key === dragging)
                setDragging(null)
                if (!from || from.home.kind !== 'rules' || !native) return
                onChange(fromDef(state, moveNativeRule(def, from.home.id, index)))
              }}
              data-rule={u.key} data-rule-home={u.home.kind}>
              <div className="flex items-start gap-1.5 p-2">
                {native ? <GripVertical size={13} className="mt-0.5 shrink-0 cursor-grab text-fg-muted" aria-hidden /> : <span className="w-[13px] shrink-0" />}
                {u.home.kind !== 'bar_button' && (
                  <input type="checkbox" className="mt-0.5 accent-primary" aria-label={`${u.rule.disabled ? 'Turn on' : 'Turn off'} ${u.rule.name ?? 'rule'}`} checked={!u.rule.disabled}
                    onChange={(e) => write(u.home, { ...u.rule, disabled: e.target.checked ? undefined : true })} title={native ? 'On / off' : 'Turning it off moves it into Rules (kept, not run)'} />
                )}
                <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : u.key)} data-rule-toggle>
                  <span className="flex flex-wrap items-center gap-1">
                    {isOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                    <span className="text-xs font-semibold">{u.rule.name || FORM_RULE_EVENT_LABELS[u.rule.event]}</span>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-2xs font-medium text-fg', native ? 'bg-primary-wash' : 'bg-warning-wash')} data-rule-badge>{u.badge}</span>
                  </span>
                  <span className="mt-0.5 block text-2xs text-fg-muted">
                    <strong>When</strong> {FORM_RULE_EVENT_LABELS[u.rule.event]}{u.rule.target ? ` · ${targetChoices(state, u.rule.event).find((t) => t.value === u.rule.target)?.label ?? u.rule.target}` : ''}
                    {' → '}<strong>If</strong> {describeConditions(def, u.rule.if)}
                    {' → '}<strong>Then</strong> {u.barActions ? u.barActions.map((a) => FORM_ACTION_LABELS[a.type as FormActionType] ?? String(a.type)).join(', ') || '—' : u.rule.then.map((a) => describeRuleAction(def, a)).join('; ') || '—'}
                  </span>
                  {u.rule.description && <span className="mt-0.5 block whitespace-pre-line text-2xs text-fg-muted line-clamp-3" data-rule-notes>{u.rule.description}</span>}
                </button>
                {native && (
                  <>
                    <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index <= 0} aria-label="Move up" onClick={() => onChange(fromDef(state, moveNativeRule(def, (u.home as { id: string }).id, index - 1)))}><ArrowUp size={12} /></button>
                    <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index >= nativeIds.length - 1} aria-label="Move down" onClick={() => onChange(fromDef(state, moveNativeRule(def, (u.home as { id: string }).id, index + 1)))}><ArrowDown size={12} /></button>
                  </>
                )}
                {u.home.kind !== 'bar_button' && (
                  <button type="button" className="rounded p-0.5" aria-label={`Duplicate ${u.rule.name ?? 'rule'}`} onClick={() => { const r = duplicateRule(def, u); onChange(fromDef(state, r.def)); setOpen(`rules:${r.id}`) }}><Copy size={12} /></button>
                )}
                <button type="button" className="rounded p-0.5" aria-label={`Delete ${u.rule.name ?? 'rule'}`} onClick={() => onChange(fromDef(state, removeUnifiedRule(def, u.home)))}><Trash2 size={12} /></button>
              </div>
              {(notes.length > 0 || (problem && !isOpen)) && (
                <div className="space-y-0.5 px-2 pb-2">
                  {problem && !isOpen && <p className="text-2xs text-danger">{problem}</p>}
                  {notes.map((n, i) => <p key={i} className="flex items-start gap-1 text-2xs text-warning" data-rule-conflict><AlertTriangle size={11} className="mt-px shrink-0" aria-hidden />{n}</p>)}
                </div>
              )}
              {isOpen && (
                <div className="border-t p-2 border-border">
                  <RuleEditor state={state} unified={u} problem={problem} onWrite={(rule, tag) => write(u.home, rule, tag ? `${u.key}-${tag}` : undefined)} onChangeState={onChange} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" aria-expanded={showTest} onClick={() => setShowTest((v) => !v)} data-testid="rules-test-toggle">
        <FlaskConical size={12} aria-hidden /> {showTest ? 'Hide the test panel' : 'Test a rule'}
      </button>
      {showTest && <TestPanel state={state} def={def} onScope={setTestScope} />}
      <p className="text-2xs text-fg-muted">
        <span className="font-semibold">Where rules live:</span> <code>Rules</code> = this form&apos;s own rules; the other badges are the field&apos;s Visible when, a button&apos;s On click / Disabled when, the bar&apos;s behaviours and start-hidden targets — editable here or there. An edit that no longer fits there (AND / OR, a condition on a click) moves the rule here.
      </p>
    </div>
    </DesignerTestSampleProvider>
  )
}
