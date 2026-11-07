'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Info, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { resolveInputTemplate } from '@/lib/forms/buttons'
import { runFieldButton, type MessageDisplay } from '@/lib/forms/field-buttons'
import type { MessageTone } from '@/lib/forms/form-messages'
import { readFormState, withFormState } from '@/lib/forms/form-state'
import { formContextScope } from '@/lib/forms/form-params'
import { enrichEventContext } from '@/lib/forms/rule-variables'
import {
  FORM_ERROR_KEY, alwaysRuleEffects, conditionPaths, disabledFieldKeys, layoutFormRules, readOnlyFieldKeys, ruleConditionsMet, rulesForEvent,
  type FormRule, type RuleEvent,
} from '@/lib/forms/form-rules'
import type { FormLayout } from '@/lib/forms/layout'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { buildActionHost, type ActionLive } from './action-host'
import { useFormPager } from './form-pages'
import { useFormRuntime } from './form-runtime'
import { isAnonymousSource, useFormLookupSource } from './lookup-field'
import { MessageCard, useFormMessages } from './form-messages'

/**
 * Runs a form's rules (lib/forms/form-rules.ts) on a live form: the
 * renderer wraps its editable views in <FormRulesScope>, which
 *
 *  - dispatches events — form loads, value changes (rule-made changes cascade
 *    at most MAX_DEPTH levels), focus / blur, step / tab changes, flag
 *    changes; components report theirs (Button clicks, Data table row
 *    clicks / selections / edits / adds / deletes, autocomplete selections)
 *    through useFormRules().dispatch;
 *  - registers Before submit with the surface's bar (FormButtonBar), so a
 *    rule can set values first or block the submission with a message;
 *  - runs each matching rule whose conditions hold, in list order, through
 *    the Button action runner and host (components/forms/action-host.ts) —
 *    server steps by rule id + action index from the saved form;
 *  - shows messages: banners and questions through the form's message
 *    centre (components/forms/form-messages.tsx); inline ones under the
 *    form (a message saved before banners keeps its original look); an
 *    answered question dispatches "A question is answered";
 *  - provides what fields are disabled and read only (state + "Always"
 *    rules; read only inherits from sections, steps / tabs, the form) and the
 *    refresh counters Data tables / autocompletes listen to.
 */

const MAX_DEPTH = 3

export interface FormRulesApi {
  dispatch: (event: RuleEvent) => void
  /** Run an event now; resolves with whether a rule blocked it (Before submit). */
  run: (event: RuleEvent) => Promise<{ blocked: boolean }>
  /** Field keys disabled by rules (Enable / disable, Always rules). */
  disabledKeys: ReadonlySet<string>
  /** Field keys read only by rules (Make read only / editable; a section, step / tab or the whole form covers its controls). */
  readOnlyKeys: ReadonlySet<string>
  /** Bumped by "Refresh" actions (per field key). */
  refreshTick: (key: string) => number
  /** A field's value changed by the person (or a rule): Value changes rules. */
  notifyChange: (key: string, value: unknown, previous: unknown) => void
}

const RulesContext = createContext<FormRulesApi | null>(null)

export function useFormRules(): FormRulesApi | null {
  return useContext(RulesContext)
}

type User = { id: string; email: string | null; name: string | null } | null

export function FormRulesScope({ fields, layout, values: rawValues, onChange, idPrefix, children }: {
  fields: TaskFieldDef[]
  layout: FormLayout | null | undefined
  values: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
  idPrefix: string
  children: React.ReactNode
}) {
  const rules = useMemo(() => layoutFormRules(layout), [layout])
  const pager = useFormPager()
  const runtime = useFormRuntime()
  const source = useFormLookupSource()
  const values = useMemo(() => withFormState(layout, rawValues), [layout, rawValues])
  const needsUser = useMemo(() => rules.some((r) => conditionPaths(r.if).some((p) => p.startsWith('user.')) || JSON.stringify(r.then).includes('{{user.')), [rules])
  const { data: user = null } = useQuery({
    queryKey: ['form-rule-user'],
    // Public form links: {{user.*}} is empty (no one is signed in).
    enabled: needsUser && !isAnonymousSource(source),
    staleTime: 5 * 60_000,
    queryFn: async () => ((await serverRead('forms.ruleUser')).data ?? null) as User,
  })
  const center = useFormMessages()
  const [messages, setMessages] = useState<Array<{ id: number; text: string; tone: MessageTone; display?: MessageDisplay; tick: number }>>([])
  const centerRef = useRef(center)
  useLayoutEffect(() => { centerRef.current = center })
  const dispatchRef = useRef<(event: RuleEvent) => void>(() => {})
  const [ticks, setTicks] = useState<Record<string, number>>({})
  const live = useRef<ActionLive>({ values, pager, runtime, onChange })
  useLayoutEffect(() => { live.current = { values, pager, runtime, onChange } })
  const depth = useRef(0)
  const userRef = useRef<User>(user)
  useLayoutEffect(() => { userRef.current = user })

  const message = useCallback((text: string, tone: MessageTone, display?: MessageDisplay) => {
    if (display?.style === 'banner' && centerRef.current) { centerRef.current.show(text, tone, display); return }
    if (!text) return
    const tick = centerRef.current?.actionTick ?? 0
    setMessages((prev) => [...prev.slice(-2), { id: Date.now() + Math.random(), text, tone, ...(display ? { display } : {}), tick }])
  }, [])

  const runRule = useCallback(async (rule: FormRule, event: RuleEvent): Promise<{ blocked: boolean }> => {
    const context = { ...(event.context ?? {}), ...(event.target ? { target: event.target } : {}) }
    const scopeUser = userRef.current as Record<string, unknown> | null
    if (!ruleConditionsMet(rule.if, { values: live.current.values, user: scopeUser, event: context })) return { blocked: false }
    const host = buildActionHost({
      live, fields, layout, idPrefix, source, message,
      owner: { kind: 'rule', ruleId: rule.id, event: context, onRefresh: (key) => setTicks((t) => ({ ...t, [key]: (t[key] ?? 0) + 1 })) },
      ...(centerRef.current ? { ask: centerRef.current.ask } : {}),
      answered: ({ id, response, label }) => dispatchRef.current({ type: 'message_answered', ...(id ? { target: id } : {}), context: { message: id ?? null, response, label } }),
    })
    const extras = { event: context, user: scopeUser }
    const result = await runFieldButton({ actions: rule.then }, host, {
      extras,
      resolve: async (template, vals, ex) => {
        if (template.includes('{{=')) {
          const { resolveExpressionValues } = await import('@/lib/expression-resolver')
          return resolveExpressionValues(template, { ...vals, ...ex, form: vals, ...formContextScope(vals) })
        }
        return resolveInputTemplate(template, { values: vals, extras: ex })
      },
    })
    // A question answered No / Cancel (or closed) stops the rest — before submit, the submission too.
    return { blocked: result.stopped === 'blocked' || result.stopped === 'invalid' || result.stopped === 'step_invalid' || result.stopped === 'prompt_stopped' || result.stopped === 'prompt_unavailable' }
  }, [fields, layout, idPrefix, source, message])

  // A blocked submit's message goes once the person does something else the rules react to.
  const clearBlock = useRef(false)
  const run = useCallback(async (raw: RuleEvent): Promise<{ blocked: boolean }> => {
    // The documented event names (row_id, previous_value, item.<field>, from / to — lib/forms/rule-variables.ts).
    const event: RuleEvent = { ...raw, context: enrichEventContext(raw.type, raw.context) }
    if (clearBlock.current && event.type !== 'before_submit') { clearBlock.current = false; setMessages([]) }
    const matched = rulesForEvent(rules, event)
    if (!matched.length || depth.current >= MAX_DEPTH) return { blocked: false }
    depth.current += 1
    let blocked = false
    try {
      for (const rule of matched) {
        const r = await runRule(rule, event)
        if (r.blocked) { blocked = true; if (event.type === 'before_submit') break }
        // Let React apply this rule's changes before the next one reads the values.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      depth.current -= 1
    }
    return { blocked }
  }, [rules, runRule])

  const dispatch = useCallback((event: RuleEvent) => { void run(event) }, [run])
  useLayoutEffect(() => { dispatchRef.current = dispatch })

  // Before submit: registered with the bar (FormButtonBar asks before its own pipeline).
  useLayoutEffect(() => {
    if (!runtime) return
    let busy = false
    runtime.rules.current = {
      beforeSubmit: async (buttonId) => {
        if (!rules.some((r) => r.event === 'before_submit' && !r.disabled)) return true
        // Another press while a Before-submit question is open: that one decides.
        if (busy) return false
        busy = true
        try {
          // A new attempt: earlier block messages go (the rules say again what still blocks).
          setMessages([])
          const { blocked } = await run({ type: 'before_submit', target: buttonId, context: { button: buttonId } })
          if (blocked) clearBlock.current = true
          return !blocked
        } finally {
          busy = false
        }
      },
    }
    return () => { if (runtime.rules.current) runtime.rules.current = null }
  }, [runtime, rules, run])

  // Form loads (once), step / tab changes, flag changes.
  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    dispatch({ type: 'form_load' })
  }, [dispatch])
  const page = pager?.currentId ?? null
  const prevPage = useRef(page)
  useEffect(() => {
    if (prevPage.current === page) return
    const previous = prevPage.current
    prevPage.current = page
    if (page) dispatch({ type: 'page_change', target: page, context: { page, previous } })
  }, [page, dispatch])
  const flags = readFormState(layout, values).flags
  const flagKey = JSON.stringify(flags)
  const prevFlags = useRef(flags)
  useEffect(() => {
    const before = prevFlags.current
    prevFlags.current = flags
    for (const [flag, value] of Object.entries(flags)) {
      if (before[flag] !== value) dispatch({ type: 'flag_change', target: flag, context: { flag, value } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the flags' JSON
  }, [flagKey, dispatch])

  const notifyChange = useCallback((key: string, value: unknown, previous: unknown) => {
    // The change is not rendered yet: the rules it runs judge (and read) the new value, as the server does.
    live.current = { ...live.current, values: { ...live.current.values, [key]: value } }
    dispatch({ type: 'value_change', target: key, context: { field: key, value, previous } })
  }, [dispatch])

  const { disabledKeys, readOnlyKeys } = useMemo(() => {
    const state = readFormState(layout, values)
    const always = alwaysRuleEffects(layout, values, { user: user as Record<string, unknown> | null, rules })
    return {
      disabledKeys: disabledFieldKeys(layout, fields, [...(state.disabled ?? []), ...always.disabled]),
      readOnlyKeys: readOnlyFieldKeys(layout, fields, [...(state.read_only ?? []), ...always.readOnly]),
    }
  }, [layout, values, user, rules, fields])

  const api = useMemo<FormRulesApi>(() => ({
    dispatch, run, disabledKeys, readOnlyKeys, notifyChange, refreshTick: (key) => ticks[key] ?? 0,
  }), [dispatch, run, disabledKeys, readOnlyKeys, notifyChange, ticks])

  // "Until the next action" inline messages go once the person does something after them.
  const actionTick = center?.actionTick ?? 0
  const shownMessages = messages.filter((m) => !(m.display?.duration === 'next_action' && m.tick < actionTick))

  return (
    <RulesContext.Provider value={api}>
      {children}
      {shownMessages.length > 0 && (
        <div aria-live="polite" className="mt-3 space-y-1" data-form-rule-messages>
          {shownMessages.map((m) => m.display ? (
            <MessageCard key={m.id} inline item={{ text: m.text, tone: m.tone, duration: m.display.duration, ...(m.display.title ? { title: m.display.title } : {}), ...(m.display.seconds ? { seconds: m.display.seconds } : {}) }}
              onClose={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))} />
          ) : (
            <p key={m.id} role="status" className="flex items-start gap-1.5 rounded-lg border px-3 py-2 text-xs border-border text-fg" data-form-rule-message>
              {m.tone === 'success' ? <Check size={12} className="mt-0.5 text-primary-text" aria-hidden /> : <Info size={12} className="mt-0.5" aria-hidden />}
              <span className="flex-1 whitespace-pre-wrap">{m.text}</span>
              <button type="button" aria-label="Dismiss" className="rounded p-0.5 hover:opacity-80" onClick={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))}><X size={11} aria-hidden /></button>
            </p>
          ))}
        </div>
      )}
    </RulesContext.Provider>
  )
}

/** A form-level error (a Before-submit / Always rule's "Block submit" without a field). */
export function FormLevelError({ errors }: { errors?: Record<string, string> | null }) {
  const message = errors?.[FORM_ERROR_KEY]
  if (!message) return null
  return (
    <p role="alert" className="mb-3 rounded-lg border px-3 py-2 text-xs border-(--status-blocked) text-(--status-blocked)" data-form-error>
      {message}
    </p>
  )
}
