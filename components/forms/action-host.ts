'use client'

import { isSubmittingButton, safeRedirectUrl } from '@/lib/forms/buttons'
import type { ActionBranch, FieldButtonAction, FieldButtonHost, MessageDisplay, PromptRequest } from '@/lib/forms/field-buttons'
import type { MessageTone } from '@/lib/forms/form-messages'
import { FORM_STATE_KEY, readFormState, type FormUiState } from '@/lib/forms/form-state'
import { FORM_VARS_KEY, setVariables } from '@/lib/forms/form-params'
import { firstPageWithError, pageIdByField } from '@/lib/forms/pages'
import { isPaged, type FormLayout } from '@/lib/forms/layout'
import { lookupFillValues, lookupItemKey, lookupLabelKey, type LookupItem } from '@/lib/forms/lookup'
import { dryRunTableChanges } from '@/lib/forms/table-changes'
import { emptyChangeSet, isChangeSet } from '@/lib/forms/data-table'
import { OPTIONS_KEY, OPTIONS_LOADING } from '@/lib/forms/data-actions'
import { staleChoiceValue } from '@/lib/forms/dynamic-values'
import { coerceTaskFieldValues, isDisplayField, validateTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import { resolveInputTemplate } from '@/lib/forms/buttons'
import type { FormPager } from './form-pages'
import type { FormRuntime } from './form-runtime'
import { formApiUrl, type FormLookupSource } from './lookup-field'

/**
 * The adapter an in-form Button and a form rule run their actions through
 * (lib/forms/field-buttons.ts runFieldButton): the surface's values and
 * state (via onChange), the pager, the bar (Submit / Save draft press the
 * bar's button) and the server steps — a Button's "Apply table changes"
 * (POST /api/internal/forms/table-changes) or a rule's server actions (POST
 * /api/internal/forms/rule-action), both looked up in the SAVED form by key /
 * id and index. In the designer preview server steps are only described.
 */

export interface ActionLive {
  /** Values with the form state (withFormState). */
  values: Record<string, unknown>
  pager: FormPager | null
  runtime: FormRuntime | null
  onChange?: (key: string, value: unknown) => void
}

export type ServerOwner =
  | { kind: 'button'; key: string }
  | {
    kind: 'rule'; ruleId: string; event?: Record<string, unknown> | null; onRefresh?: (field: string) => void
    /** An event the steps caused (row_created, row_committed…): its rules run next. */
    onEmit?: (type: string, target: string, context: Record<string, unknown>) => void
    /** An editable Data table's rows on screen. */
    tableRows?: (field: string) => Array<{ key: string; values: Record<string, unknown> }>
  }

export function blankFor(field: TaskFieldDef | undefined): unknown {
  if (!field) return null
  if (field.type === 'boolean') return false
  if (field.type === 'multi_choice' || field.type === 'list' || field.type === 'attachments' || (field.type === 'lookup' && field.lookup?.multiple)) return []
  return null
}

function shortHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function clickKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
  const json = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok) throw new Error(typeof json?.error === 'string' ? json.error : res.status === 429 ? 'Too many requests — wait a moment' : 'That step could not run')
  return json ?? {}
}

function sourceBody(source: FormLookupSource): Record<string, unknown> {
  return source.kind === 'task' ? { task_id: source.taskId } : source.kind === 'form' ? { form_id: source.formId } : {}
}

export function buildActionHost({ live, fields, layout, idPrefix, source, message, owner, ask, answered }: {
  live: { current: ActionLive }
  fields: TaskFieldDef[]
  layout: FormLayout | null | undefined
  idPrefix: string
  source: FormLookupSource | null
  /** `display` set: a "Show a message" with banner / inline options (the caller sends banners to the message centre). */
  message: (text: string, tone: MessageTone, display?: MessageDisplay) => void
  owner: ServerOwner
  /** The message centre's question (components/forms/form-messages.tsx); absent: questions are not available. */
  ask?: (request: PromptRequest) => Promise<string>
  /** A question was answered ("Message answered" rules). */
  answered?: (answer: { id?: string; response: string; label: string }) => void
}): FieldButtonHost {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const key = clickKey()
  const preview = !source || source.kind === 'preview'

  async function ruleAction(index: number, values: Record<string, unknown>, branch?: ActionBranch, event?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (owner.kind !== 'rule' || !source) throw new Error('Not available here')
    // A step run once per selected row: that row as the event, and a key of its own (each run is applied once).
    const rowKey = event && (typeof event.row_number === 'number' || event.commit) ? `${key}:r${event.row_number ?? ''}:${shortHash(JSON.stringify(event.commit ?? event.key ?? ''))}` : key
    return postJson(formApiUrl(source, 'rule-action'), {
      ...sourceBody(source), rule_id: owner.ruleId, action_index: index, ...(branch ? { branch } : {}), values: stripState(values), event: event ?? owner.event ?? null, idempotency_key: rowKey.slice(0, 100),
    })
  }

  /** Cascades: the controls whose options this step loads show "Loading options…" (and are disabled) until it answers. */
  async function withOptionsLoading<T>(action: FieldButtonAction, work: () => Promise<T>): Promise<T> {
    const targets = (action.outputs ?? []).filter((o) => o.as === 'options').map((o) => o.to)
    if (!targets.length) return work()
    const mark = (on: boolean) => {
      const current = live.current.values[OPTIONS_KEY] && typeof live.current.values[OPTIONS_KEY] === 'object' ? live.current.values[OPTIONS_KEY] as Record<string, unknown> : {}
      const loading = new Set(Array.isArray(current[OPTIONS_LOADING]) ? current[OPTIONS_LOADING] as string[] : [])
      for (const t of targets) { if (on) loading.add(t); else loading.delete(t) }
      live.current.onChange?.(OPTIONS_KEY, { ...current, [OPTIONS_LOADING]: [...loading] })
    }
    mark(true)
    try { return await work() } finally { await new Promise((r) => setTimeout(r, 0)); mark(false) }
  }

  return {
    values: () => live.current.values,
    state: () => readFormState(layout, live.current.values),
    setValues: (patch) => { for (const [k, v] of Object.entries(patch)) live.current.onChange?.(k, v) },
    setState: (next: FormUiState) => live.current.onChange?.(FORM_STATE_KEY, next),
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    goTo: (pageId) => { live.current.pager?.goTo(pageId); return Boolean(live.current.pager) },
    next: () => live.current.pager?.next() ?? false,
    back: () => { live.current.pager?.back(); return Boolean(live.current.pager) },
    validate: (scope) => {
      const { pager: p, runtime: r, values: v } = live.current
      if (scope === 'page' && p) return p.validateCurrent()
      r?.lazy.current?.loadForSubmit()
      const errors = validateTaskFieldValues(fields, v, { layout })
      r?.setErrors(errors)
      const keys = Object.keys(errors)
      if (!keys.length) return true
      const target = isPaged(layout) ? firstPageWithError(layout, errors, v) : null
      if (target && p && target !== p.currentId) p.goTo(target)
      requestAnimationFrame(() => document.getElementById(`${idPrefix}${fields.find((f) => errors[f.key])?.key ?? keys[0]}`)?.focus())
      return false
    },
    submit: (buttonId) => {
      const bar = live.current.runtime?.bar.current
      if (!bar || bar.disabled) return false
      const button = bar.buttons.find((b) => b.id === buttonId && isSubmittingButton(b)) ?? bar.buttons.find(isSubmittingButton)
      if (!button) return false
      bar.onClick(button)
      return true
    },
    saveDraft: () => {
      const bar = live.current.runtime?.bar.current
      const button = bar?.buttons.find((b) => b.kind === 'draft')
      if (!bar || !button || bar.disabled) return false
      bar.onClick(button)
      return true
    },
    // When to load (lib/forms/lazy-load.ts): print what the form holds — lazy parts load first, then the dialog opens.
    print: () => { if (live.current.runtime?.lazy.current?.loadAll()) window.setTimeout(() => window.print(), 400); else window.print() },
    openLink: async (url, newTab) => {
      let target = safeRedirectUrl(url, { appOrigin: window.location.origin })
      if (!target) {
        // Another host: allowed only when on the server's allow list (FORM_REDIRECT_ALLOWLIST).
        const { checkFormLink } = await import('@/app/actions/forms')
        target = await checkFormLink(url).catch(() => null)
      }
      if (!target) return false
      if (newTab) window.open(target, '_blank', 'noopener,noreferrer')
      else window.location.assign(target)
      return true
    },
    message,
    ...(ask ? { ask } : {}),
    ...(answered ? { answered } : {}),
    // "Apply table changes": on the server (the rule comes from the saved form); the designer preview only dry-runs it.
    applyTableChanges: async (index, action, branch) => {
      const rule = action.table_changes
      if (!rule) throw new Error('The step is not configured')
      const current = live.current.values
      if (preview) {
        const value = current[rule.field]
        const columnTypes = Object.fromEntries((byKey.get(rule.field)?.data_table?.columns ?? []).map((c) => [c.key, c.type]))
        const { summary } = dryRunTableChanges(rule, isChangeSet(value) ? value : emptyChangeSet(), { values: current }, columnTypes)
        return { text: `${summary.text} (nothing is written in a preview)`, failed: 0 }
      }
      const json = owner.kind === 'button'
        ? await postJson(formApiUrl(source, 'table-changes'), { ...sourceBody(source!), button_key: owner.key, action_index: index, ...(branch ? { branch } : {}), values: current, idempotency_key: key })
        : await ruleAction(index, current, branch)
      // Applied: the table shows the source's rows again (failed rows stay as edits to retry).
      if (!json.failed) live.current.onChange?.(rule.field, null)
      return { text: typeof json.text === 'string' ? json.text : 'Done', failed: typeof json.failed === 'number' ? json.failed : 0 }
    },
    fieldError: (field, text) => {
      const r = live.current.runtime
      if (!r) { message(text, 'info'); return }
      r.setErrors({ ...r.errors, [field]: text })
      // The field is on another step / tab (a Before-submit rule on the last step): go there so the error shows.
      const p = live.current.pager
      const page = isPaged(layout) ? pageIdByField(layout).get(field) : undefined
      if (p && page && page !== p.currentId) p.goTo(page, { focus: false })
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`${idPrefix}${field}`)?.focus()))
    },
    runExtra: async (index, action: FieldButtonAction, values, branch, event) => {
      if (owner.kind !== 'rule') return { stop: `${action.type}_unavailable` }
      switch (action.type) {
        case 'refresh':
        case 'refresh_table':
          if (action.field) owner.onRefresh?.(action.field)
          return
        case 'commit_row':
        case 'delete_row': {
          // A Data table row's "Save now": the saved step (by rule id + index) writes the row the event carries, checked again.
          const name = byKey.get(action.field ?? '')?.data_table?.table_id ? (byKey.get(action.field ?? '')?.label ?? 'the table') : 'the table'
          if (preview) return { kept: true, message: { text: `Would ${action.type === 'delete_row' ? 'delete the row from' : 'save the row to'} ${name} now (nothing is written in a preview)`, tone: 'info' } }
          const json = await ruleAction(index, values, branch, event)
          return { ...(typeof json.text === 'string' && json.text ? { message: { text: json.text, tone: 'success' as const } } : {}), result: json.result ?? null }
        }
        case 'run_lookup': {
          const field = action.field ? byKey.get(action.field) : undefined
          if (!field?.lookup || !source) return { message: { text: 'The lookup is not available here.', tone: 'info' } }
          const { resolveRuleTemplate } = await import('@/lib/forms/form-rules')
          const query = String(resolveRuleTemplate(action.query ?? '', { values, event: owner.event ?? null }) ?? '')
          const body = source.kind === 'preview' ? { field, query, values: stripState(values) } : { ...sourceBody(source), field_key: field.key, query, values: stripState(values) }
          const json = await postJson(source.kind === 'preview' ? '/api/internal/forms/lookup' : formApiUrl(source, 'lookup'), body)
          const item = (Array.isArray(json.items) ? json.items[0] : null) as LookupItem | null
          const patch: Record<string, unknown> = item
            ? { [field.key]: field.lookup.multiple ? [item.value] : item.value, [lookupItemKey(field.key)]: field.lookup.multiple ? [item.fields] : item.fields, [lookupLabelKey(field.key)]: field.lookup.multiple ? [item.label] : item.label }
            : {}
          if (item && field.lookup.fill?.length) Object.assign(patch, lookupFillValues(field.lookup, item))
          return item ? { values: patch } : { message: { text: `No match for "${query}"`, tone: 'info' } }
        }
        case 'table_read':
        case 'table_list':
        case 'table_create':
        case 'table_update':
        case 'table_delete': {
          if (preview) return { message: { text: `Would ${({ table_read: 'read a row of', table_list: 'list rows of', table_create: 'add a row to', table_update: 'update rows of', table_delete: 'delete a row of' } as const)[action.type]} ${action.table_name ?? 'the table'} (nothing runs in a preview — use Test in the rule)`, tone: 'info' } }
          const json = await withOptionsLoading(action, () => ruleAction(index, values, branch, event))
          return { values: resultValues(json, live.current.values), ...(typeof json.text === 'string' && json.text ? { message: { text: json.text, tone: 'success' as const } } : {}), result: json.result ?? null }
        }
        case 'call_reference':
        case 'start_workflow':
          if (preview) return { message: { text: `${action.type === 'call_reference' ? (action.wait === false ? 'Would send the API call without waiting' : 'Would call the API reference') : `Would start ${action.workflow_name ?? 'the workflow'}`} (nothing runs in a preview)`, tone: 'info' } }
          {
            let json: Record<string, unknown>
            try {
              json = await withOptionsLoading(action, () => ruleAction(index, values, branch))
            } catch (error) {
              // "If the call fails": leave the fields as they are and go on with the rule, or show the author's message.
              if (action.type !== 'call_reference') throw error
              const [{ resolveRuleTemplate }, { callReferenceFailure }] = await Promise.all([import('@/lib/forms/form-rules'), import('@/lib/forms/reference-results')])
              const outcome = callReferenceFailure(action, error, (text) => resolveRuleTemplate(text, { values, event: owner.event ?? null }))
              if ('ignore' in outcome) return
              throw new Error(outcome.message)
            }
            // Fire and forget: queued on the server — a small "Sent" note, nothing written.
            if (json.queued) return { message: { text: typeof json.text === 'string' && json.text ? json.text : 'Sent', tone: 'success' as const }, result: null }
            return { values: resultValues(json, live.current.values), ...(typeof json.text === 'string' && json.text ? { message: { text: json.text, tone: 'success' as const } } : {}), result: json.result ?? null }
          }
        default:
          return
      }
    },
    // A rule may also write read-only value fields (the server keeps such a value only when a rule could produce it).
    // Labels: rules only (the server checks what they could have written; a Button's steps are not replayed).
    editableKeys: new Set(fields.filter((f) => !isDisplayField(f) && ((!f.read_only && f.type !== 'label') || owner.kind === 'rule')).map((f) => f.key)),
    blank: (k) => blankFor(byKey.get(k)),
    field: (k) => byKey.get(k),
    ...(owner.kind === 'rule' && owner.onEmit ? { emit: owner.onEmit } : {}),
    ...(owner.kind === 'rule' && owner.tableRows ? { tableRows: owner.tableRows } : {}),
    // After "Add row" / "Cancel editing": the field's default again (placeholders resolved against the form as it is now).
    reset: (k) => resetFor(byKey.get(k), live.current.values),
  }
}

/**
 * What a server step's answer writes: field values, variables (`var.<name>` →
 * the form's variables) and options a step loaded into choice fields (kept
 * under OPTIONS_KEY; the renderer shows them, the server re-checks values).
 */
function resultValues(json: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = json.values && typeof json.values === 'object' ? { ...json.values as Record<string, unknown> } : {}
  if (json.vars && typeof json.vars === 'object') patch[FORM_VARS_KEY] = { ...setVariables(values), ...json.vars as Record<string, unknown> }
  if (json.options && typeof json.options === 'object') {
    const current = values[OPTIONS_KEY] && typeof values[OPTIONS_KEY] === 'object' ? values[OPTIONS_KEY] as Record<string, unknown> : {}
    patch[OPTIONS_KEY] = { ...current, ...json.options as Record<string, unknown> }
    // Cascades: a dependent's value its new options no longer offer is cleared (a valid one is kept).
    for (const [key, options] of Object.entries(json.options as Record<string, unknown>)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) continue
      const v = values[key]
      const fixed = staleChoiceValue(Array.isArray(v) ? 'multi_choice' : 'choice', v, options)
      if (fixed !== undefined) patch[key] = fixed
    }
  }
  return Object.keys(patch).length ? patch : undefined
}

/** A field's default value, its {{placeholders}} resolved (a bound default re-applies itself once the field is empty), else blank. */
export function resetFor(field: TaskFieldDef | undefined, values: Record<string, unknown>): unknown {
  if (!field) return null
  if (field.default === undefined || field.default === '' || field.dynamic?.default) return blankFor(field)
  const raw = field.default.includes('{{') ? resolveInputTemplate(field.default, { values }) : field.default
  const typed = coerceTaskFieldValues([field], { [field.key]: raw })[field.key]
  return typed === undefined ? blankFor(field) : typed
}

function stripState(values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values }
  delete out[FORM_STATE_KEY]
  delete out[OPTIONS_KEY]
  return out
}
