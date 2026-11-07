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
import { isDisplayField, validateTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
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
  | { kind: 'rule'; ruleId: string; event?: Record<string, unknown> | null; onRefresh?: (field: string) => void }

export function blankFor(field: TaskFieldDef | undefined): unknown {
  if (!field) return null
  if (field.type === 'boolean') return false
  if (field.type === 'multi_choice' || field.type === 'attachments' || (field.type === 'lookup' && field.lookup?.multiple)) return []
  return null
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

  async function ruleAction(index: number, values: Record<string, unknown>, branch?: ActionBranch): Promise<Record<string, unknown>> {
    if (owner.kind !== 'rule' || !source) throw new Error('Not available here')
    return postJson(formApiUrl(source, 'rule-action'), {
      ...sourceBody(source), rule_id: owner.ruleId, action_index: index, ...(branch ? { branch } : {}), values: stripState(values), event: owner.event ?? null, idempotency_key: key,
    })
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
    runExtra: async (index, action: FieldButtonAction, values, branch) => {
      if (owner.kind !== 'rule') return { stop: `${action.type}_unavailable` }
      switch (action.type) {
        case 'refresh':
          if (action.field) owner.onRefresh?.(action.field)
          return
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
        case 'call_reference':
        case 'start_workflow':
          if (preview) return { message: { text: `${action.type === 'call_reference' ? 'Would call the API reference' : `Would start ${action.workflow_name ?? 'the workflow'}`} (nothing runs in a preview)`, tone: 'info' } }
          {
            let json: Record<string, unknown>
            try {
              json = await ruleAction(index, values, branch)
            } catch (error) {
              // "If the call fails": leave the fields as they are and go on with the rule, or show the author's message.
              if (action.type !== 'call_reference') throw error
              const [{ resolveRuleTemplate }, { callReferenceFailure }] = await Promise.all([import('@/lib/forms/form-rules'), import('@/lib/forms/reference-results')])
              const outcome = callReferenceFailure(action, error, (text) => resolveRuleTemplate(text, { values, event: owner.event ?? null }))
              if ('ignore' in outcome) return
              throw new Error(outcome.message)
            }
            const patch = json.values && typeof json.values === 'object' ? { ...json.values as Record<string, unknown> } as Record<string, unknown> : undefined
            // API results mapped to `var.<name>`: the form's variables (lib/forms/form-params.ts).
            const vars = json.vars && typeof json.vars === 'object' ? { [FORM_VARS_KEY]: { ...setVariables(values), ...json.vars as Record<string, unknown> } } : null
            if (vars) return { values: { ...(patch ?? {}), ...vars }, ...(typeof json.text === 'string' && json.text ? { message: { text: json.text, tone: 'success' as const } } : {}) }
            return { values: patch, ...(typeof json.text === 'string' && json.text ? { message: { text: json.text, tone: 'success' as const } } : {}) }
          }
        default:
          return
      }
    },
    // A rule may also write read-only value fields (the server keeps such a value only when a rule could produce it).
    // Labels: rules only (the server checks what they could have written; a Button's steps are not replayed).
    editableKeys: new Set(fields.filter((f) => !isDisplayField(f) && ((!f.read_only && f.type !== 'label') || owner.kind === 'rule')).map((f) => f.key)),
    blank: (k) => blankFor(byKey.get(k)),
  }
}

function stripState(values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values }
  delete out[FORM_STATE_KEY]
  return out
}
