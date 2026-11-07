/**
 * Form messages and questions (lib/forms/form-messages.ts, the "Show a
 * message" / "Ask a question" actions of lib/forms/field-buttons.ts):
 * old messages keep their inline look; banner options (tone, title,
 * durations, auto-hide paused on hover / focus, at most three banners);
 * each preset's buttons; Yes / No branches and Cancel stopping the rest;
 * the "A question is answered" rule event; a before-submit confirm; the
 * portability round trip; server steps inside a branch reachable only when
 * the saved form declares them (a forged response reaches nothing); the
 * accessibility check; the message centre's markup.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AutoHideTimer, DISMISSED_RESPONSE, MAX_VISIBLE_BANNERS, afterNextAction, bannerRole, clampSeconds, escapeResponse, normalizePromptConfig,
  presetButtons, visibleBanners, type TimerClock,
} from '@/lib/forms/form-messages'
import {
  actionAt, allActions, messageDisplay, normalizeFieldButton, normalizeFieldButtonAction, runFieldButton,
  type FieldButtonAction, type FieldButtonHost, type PromptRequest,
} from '@/lib/forms/field-buttons'
import {
  findServerRuleAction, formRuleProblem, normalizeFormRules, promptIds, renameRuleKey, ruleConditionsMet, rulesForEvent, simulateRuleEvent,
  type RuleKnown,
} from '@/lib/forms/form-rules'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { FORM_STATE_KEY, readFormState, sanitizeFormState, submittingButtonKeys } from '@/lib/forms/form-state'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { remapKnownIds, createEmptyAssetIdMaps } from '@/lib/portability/id-maps'
import { scanAssetReferences } from '@/lib/portability/dependencies'
import { STRUCTURAL_RULES } from '@/lib/forms/accessibility/rules'
import { MessageCard } from '@/components/forms/form-messages'
import { FormRenderer } from '@/components/forms/form-renderer'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A host that records what ran and answers questions with `answers` in order. */
function makeHost(answers: string[] = [], extra: Partial<FieldButtonHost> = {}) {
  let values: Record<string, unknown> = { [FORM_STATE_KEY]: { flags: {}, hidden: [] } }
  const log: string[] = []
  const asked: PromptRequest[] = []
  const answered: Array<{ id?: string; response: string; label: string }> = []
  const messages: Array<{ text: string; tone: string; display?: unknown; args: number }> = []
  const host: FieldButtonHost = {
    values: () => values,
    state: () => readFormState(null, values),
    setValues: (p) => { values = { ...values, ...p }; log.push(`set:${Object.keys(p).join(',')}`) },
    setState: (s) => { values = { ...values, [FORM_STATE_KEY]: s } },
    flush: async () => {},
    goTo: (id) => { log.push(`go:${id}`); return true },
    next: () => true, back: () => true, validate: () => true,
    submit: () => { log.push('submit'); return true },
    saveDraft: () => true, print: () => {}, openLink: () => true,
    message: (...args: unknown[]) => { messages.push({ text: String(args[0]), tone: String(args[1]), display: args[2], args: args.length }); log.push(`msg:${args[0]}`) },
    ask: async (req) => { asked.push(req); return answers.shift() ?? DISMISSED_RESPONSE },
    answered: (a) => { answered.push(a) },
    editableKeys: new Set(['name', 'city', 'status']),
    blank: () => null,
    ...extra,
  }
  return { host, log, asked, answered, messages, values: () => values }
}

const DELETE_PROMPT = normalizeFieldButtonAction({
  type: 'prompt', title: 'Delete rows?', text: 'Delete {{count}} rows?', tone: 'warning',
  prompt: {
    id: 'confirm_delete', display: 'dialog', preset: 'yes_no',
    buttons: [
      { value: 'yes', label: 'Delete', style: 'danger', then: [{ type: 'set_values', assign: { status: 'deleting' } }], continue: true },
      { value: 'no', label: 'Keep', then: [{ type: 'message', text: 'Nothing deleted', style: 'banner' }] },
    ],
  },
}, { rule: true })!

describe('Show a message: old messages are unchanged', () => {
  it('a message saved before banners keeps no style and shows inline exactly as before', async () => {
    const old = normalizeFieldButtonAction({ type: 'message', text: 'Saved {{name}}', tone: 'success' })!
    expect(old).toEqual({ type: 'message', text: 'Saved {{name}}', tone: 'success' })
    expect(messageDisplay(old)).toBeUndefined()
    const { host, messages } = makeHost()
    await runFieldButton({ actions: [old, { type: 'message', text: 'plain' }] }, host, { extras: {} })
    // The original two-argument call (text, success | info): the surfaces draw their original inline line.
    expect(messages.map((m) => [m.tone, m.args])).toEqual([['success', 2], ['info', 2]])
  })

  it('new options: banner / inline, tone, title, duration and seconds (clamped 2–60)', () => {
    const banner = normalizeFieldButtonAction({ type: 'message', text: 'Hi', title: 'Saved', tone: 'error', style: 'banner', duration: 'auto', seconds: 99, junk: 1 })!
    expect(banner).toEqual({ type: 'message', text: 'Hi', title: 'Saved', tone: 'error', style: 'banner', duration: 'auto', seconds: 60 })
    expect(messageDisplay(banner, 'Saved')).toEqual({ style: 'banner', title: 'Saved', duration: 'auto', seconds: 60 })
    expect(normalizeFieldButtonAction({ type: 'message', style: 'inline', duration: 'dismiss', tone: 'info' })).toEqual({ type: 'message', text: 'Done.', style: 'inline' })
    expect(normalizeFieldButtonAction({ type: 'message', style: 'banner', duration: 'sticky', seconds: 3 })).toEqual({ type: 'message', text: 'Done.', style: 'banner', duration: 'sticky' })
    expect([clampSeconds(1), clampSeconds('7'), clampSeconds('x'), clampSeconds(61)]).toEqual([2, 7, 6, 60])
  })

  it('placeholders fill the text and title; banner display is passed to the host', async () => {
    const { host, messages } = makeHost()
    await runFieldButton({ actions: [{ type: 'message', title: 'Hi {{name}}', text: 'Row {{event.row.id}}', style: 'banner', tone: 'success', duration: 'next_action' }] }, host, { extras: { event: { row: { id: 7 } } } })
    // values come from the host
    expect(messages[0]).toMatchObject({ text: 'Row 7', tone: 'success', display: { style: 'banner', duration: 'next_action' } })
  })

  it('forms without rules or buttons render without the message centre', () => {
    const fields = normalizeTaskFields([{ key: 'name', label: 'Name', type: 'text' }])
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FormRenderer, { fields, values: {}, onChange: () => {} } as any)))
    expect(html).not.toContain('data-form-messages')
    const withButton = normalizeTaskFields([{ key: 'name', label: 'Name', type: 'text' }, { key: 'go', label: 'Go', type: 'button', button: { style: 'primary', actions: [{ type: 'message', text: 'x' }] } }])
    const html2 = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FormRenderer, { fields: withButton, values: {}, onChange: () => {} } as any)))
    expect(html2).toContain('data-form-messages')
    // No banners yet: no sticky stack is drawn.
    expect(html2).not.toContain('data-form-banners')
  })
})

describe('banners: roles, durations, the stack', () => {
  it('role=alert for warnings and errors, role=status otherwise; sticky banners have no close button', () => {
    expect([bannerRole('info'), bannerRole('success'), bannerRole('warning'), bannerRole('error')]).toEqual(['status', 'status', 'alert', 'alert'])
    const error = renderToStaticMarkup(createElement(MessageCard, { item: { text: 'Bad', title: 'Oops', tone: 'error', duration: 'dismiss' }, onClose: () => {} }))
    expect(error).toContain('role="alert"')
    expect(error).toContain('data-form-banner-close')
    expect(error).toContain('Oops')
    const sticky = renderToStaticMarkup(createElement(MessageCard, { item: { text: 'Note', tone: 'info', duration: 'sticky' }, onClose: () => {} }))
    expect(sticky).toContain('role="status"')
    expect(sticky).not.toContain('data-form-banner-close')
  })

  it('auto-hide expires on time and pauses while hovered or focused (WCAG 2.2.1)', () => {
    let now = 0
    const timers: Array<{ at: number; fn: () => void; id: number }> = []
    let seq = 0
    const clock: TimerClock = {
      now: () => now,
      setTimeout: (fn, ms) => { const t = { at: now + ms, fn, id: ++seq }; timers.push(t); return t.id },
      clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) },
    }
    const advance = (ms: number) => { now += ms; for (const t of [...timers]) if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn() } }
    const onExpire = vi.fn()
    const timer = new AutoHideTimer(6000, onExpire, clock)
    timer.start()
    advance(4000)
    timer.pause('hover')
    advance(60_000)
    expect(onExpire).not.toHaveBeenCalled()
    expect(timer.left).toBe(2000)
    timer.pause('focus')
    timer.resume('hover')
    advance(10_000)
    expect(onExpire).not.toHaveBeenCalled() // still focused
    timer.resume('focus')
    advance(1999)
    expect(onExpire).not.toHaveBeenCalled()
    advance(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('at most three banners show (older ones collapse); "until the next action" banners go on the next action', () => {
    const items = [1, 2, 3, 4, 5].map((id) => ({ id, duration: id === 5 ? 'next_action' as const : 'dismiss' as const }))
    const { shown, collapsed } = visibleBanners(items)
    expect(MAX_VISIBLE_BANNERS).toBe(3)
    expect(shown.map((b) => b.id)).toEqual([3, 4, 5])
    expect(collapsed).toBe(2)
    expect(visibleBanners(items, true).shown).toHaveLength(5)
    expect(afterNextAction(items).map((b) => b.id)).toEqual([1, 2, 3, 4])
  })
})

describe('Ask a question: presets and responses', () => {
  it('each preset has its buttons; Yes / OK continue by default; Escape answers Cancel, else No, else "closed"', () => {
    expect(presetButtons('ok').map((b) => [b.value, b.label, b.continue === true])).toEqual([['ok', 'OK', true]])
    expect(presetButtons('ok_cancel').map((b) => b.value)).toEqual(['ok', 'cancel'])
    expect(presetButtons('yes_no').map((b) => [b.value, b.continue === true])).toEqual([['yes', true], ['no', false]])
    expect(presetButtons('yes_no_cancel').map((b) => b.value)).toEqual(['yes', 'no', 'cancel'])
    const norm = (raw: unknown) => normalizePromptConfig(raw, (l) => l)
    expect(escapeResponse(norm({ preset: 'yes_no' }))).toBe('no')
    expect(escapeResponse(norm({ preset: 'yes_no_cancel' }))).toBe('cancel')
    expect(escapeResponse(norm({ preset: 'ok' }))).toBe(DISMISSED_RESPONSE)
    expect(escapeResponse(norm({ preset: 'yes_no', escape: 'yes' }))).toBe('yes')
    expect(escapeResponse(norm({ preset: 'yes_no', escape: 'bogus' }))).toBe('no')
  })

  it('presets keep their values (extra buttons dropped, labels kept); custom buttons are cleaned', () => {
    const p = normalizePromptConfig({ preset: 'yes_no', buttons: [{ value: 'no', label: 'Keep it', style: 'danger' }, { value: 'maybe', label: 'Maybe' }] }, (l) => l)
    expect(p.buttons).toEqual([{ value: 'yes', label: 'Yes', style: 'primary', continue: true }, { value: 'no', label: 'Keep it', style: 'danger' }])
    const c = normalizePromptConfig({ preset: 'custom', display: 'dialog', id: 'pick', buttons: [{ value: 'later', label: 'Later', continue: true }, { value: 'later', label: 'dupe' }, { value: 'Bad Value', label: 'x' }, { value: 'now', label: 'Now', style: 'primary' }] }, (l) => l)
    expect(c).toEqual({ id: 'pick', display: 'dialog', preset: 'custom', buttons: [{ value: 'later', label: 'Later', style: 'secondary', continue: true }, { value: 'now', label: 'Now', style: 'primary' }] })
    // A response's actions cannot ask another question (one level).
    const nested = normalizeFieldButtonAction({ type: 'prompt', prompt: { preset: 'ok', buttons: [{ value: 'ok', then: [{ type: 'prompt' }, { type: 'print' }] }] } })!
    expect(nested.prompt!.buttons[0].then).toEqual([{ type: 'print' }])
    expect(nested.text).toBe('Are you sure?')
  })

  it('the host is asked with the filled text, tone, display and buttons', async () => {
    const { host, asked } = makeHost(['yes'])
    await runFieldButton({ actions: [DELETE_PROMPT] }, host, { extras: { count: 3 } as any })
    expect(asked[0]).toEqual({
      id: 'confirm_delete', title: 'Delete rows?', text: 'Delete 3 rows?', tone: 'warning', display: 'dialog', escape: 'no',
      buttons: [{ value: 'yes', label: 'Delete', style: 'danger' }, { value: 'no', label: 'Keep', style: 'secondary' }],
    })
  })
})

describe('Ask a question: branches and sequencing', () => {
  const after: FieldButtonAction = { type: 'go_to_page', page: 'done' }

  it('Yes runs its branch, then the steps after the question', async () => {
    const { host, log, answered } = makeHost(['yes'])
    const run = await runFieldButton({ actions: [DELETE_PROMPT, after] }, host)
    expect(log).toEqual(['set:status', 'go:done'])
    expect(run.stopped).toBeUndefined()
    expect(run.answers).toEqual([{ id: 'confirm_delete', response: 'yes' }])
    expect(answered).toEqual([{ id: 'confirm_delete', response: 'yes', label: 'Delete' }])
  })

  it('No runs its branch and stops the rest', async () => {
    const { host, log } = makeHost(['no'])
    const run = await runFieldButton({ actions: [DELETE_PROMPT, after] }, host)
    expect(log).toEqual(['msg:Nothing deleted'])
    expect(run.stopped).toBe('prompt_stopped')
  })

  it('Cancel or a closed prompt stops the rest unless the author maps it to continue', async () => {
    const ync = normalizeFieldButtonAction({ type: 'prompt', prompt: { preset: 'yes_no_cancel' } })!
    for (const answer of ['cancel', DISMISSED_RESPONSE]) {
      const { host, log } = makeHost([answer])
      const run = await runFieldButton({ actions: [ync, after] }, host)
      expect(log).toEqual([])
      expect(run.stopped).toBe('prompt_stopped')
    }
    const mapped = normalizeFieldButtonAction({ type: 'prompt', prompt: { preset: 'yes_no_cancel', buttons: [{ value: 'cancel', continue: true }] } })!
    const { host, log } = makeHost(['cancel'])
    expect((await runFieldButton({ actions: [mapped, after] }, host)).stopped).toBeUndefined()
    expect(log).toEqual(['go:done'])
  })

  it('a branch that submits ends the run; without a host that can ask, the question stops the run', async () => {
    const submitOnYes = normalizeFieldButtonAction({ type: 'prompt', prompt: { preset: 'yes_no', buttons: [{ value: 'yes', then: [{ type: 'submit' }], continue: true }] } })!
    const { host, log } = makeHost(['yes'])
    await runFieldButton({ actions: [submitOnYes, after] }, host)
    expect(log).toEqual(['submit'])
    const noAsk = makeHost([], { ask: undefined })
    expect((await runFieldButton({ actions: [submitOnYes, after] }, noAsk.host)).stopped).toBe('prompt_unavailable')
  })

  it('server steps inside a branch are addressed by the question index plus { response, index }', async () => {
    const calls: unknown[] = []
    const q = normalizeFieldButtonAction({ type: 'prompt', prompt: { preset: 'yes_no', buttons: [{ value: 'yes', then: [{ type: 'print' }, { type: 'start_workflow', workflow_id: u(5) }], continue: true }] } }, { rule: true })!
    const { host } = makeHost(['yes'], { runExtra: async (index, action, _v, branch) => { calls.push({ index, type: action.type, branch }) } })
    await runFieldButton({ actions: [{ type: 'print' }, q] }, host)
    expect(calls).toEqual([{ index: 1, type: 'start_workflow', branch: { response: 'yes', index: 1 } }])
  })
})

describe('rules: "A question is answered", before submit, the Rules tab', () => {
  const rules = normalizeFormRules([
    { id: 'confirm', name: 'Are you sure?', event: 'before_submit', then: [{ type: 'prompt', text: 'Submit now?', prompt: { id: 'sure', preset: 'yes_no', buttons: [{ value: 'no', then: [{ type: 'message', text: 'Not sent', style: 'banner' }] }] } }] },
    { id: 'answered', event: 'message_answered', target: 'sure', if: { match: 'all', conditions: [{ column: 'event.response', operator: 'eq', value: 'no' }] }, then: [{ type: 'set_values', assign: { status: 'draft' } }] },
  ])
  const def = { fields: normalizeTaskFields([{ key: 'status', label: 'Status', type: 'text' }]) as any, layout: { rows: [], rules } as any, buttons: null }

  it('the event is stored, matched by the question name and reads event.response', () => {
    expect(rules[1]).toMatchObject({ event: 'message_answered', target: 'sure' })
    expect(rulesForEvent(rules, { type: 'message_answered', target: 'sure', context: { response: 'no' } }).map((r) => r.id)).toEqual(['answered'])
    expect(rulesForEvent(rules, { type: 'message_answered', target: 'other' })).toEqual([])
    expect(ruleConditionsMet(rules[1].if, { values: {}, event: { message: 'sure', response: 'no' } })).toBe(true)
    expect(ruleConditionsMet(rules[1].if, { values: {}, event: { message: 'sure', response: 'yes' } })).toBe(false)
    expect(promptIds(def)).toEqual(['sure'])
  })

  it('before submit: Yes lets the submission go on; No stops it (the runtime blocks on prompt_stopped)', async () => {
    const yes = makeHost(['yes'])
    expect((await runFieldButton({ actions: rules[0].then }, yes.host)).stopped).toBeUndefined()
    const no = makeHost(['no'])
    expect((await runFieldButton({ actions: rules[0].then }, no.host)).stopped).toBe('prompt_stopped')
    expect(no.messages.map((m) => m.text)).toEqual(['Not sent'])
  })

  it('designer problems: unknown question names, submitting again from Before submit, a question with no text', () => {
    const known: RuleKnown = { fieldKeys: new Set(['status']), valueKeys: new Set(['status']), fieldTypes: new Map([['status', 'text']]), pageIds: new Set(), flags: new Set(), messageIds: new Set(['sure']) }
    expect(formRuleProblem(rules[1], known)).toBeNull()
    expect(formRuleProblem({ ...rules[1], target: 'nope' }, known)).toMatch(/no question on this form is named "nope"/)
    const resubmit = normalizeFormRules([{ id: 'x', event: 'before_submit', then: [{ type: 'prompt', prompt: { preset: 'yes_no', buttons: [{ value: 'yes', then: [{ type: 'submit' }] }] } }] }])[0]
    expect(formRuleProblem(resubmit, known)).toMatch(/would submit again/)
    const badBranch = normalizeFormRules([{ id: 'y', event: 'button_click', target: 'go', then: [{ type: 'prompt', prompt: { preset: 'ok', buttons: [{ value: 'ok', then: [{ type: 'clear_values', fields: ['ghost'] }] }] } }] }])[0]
    expect(formRuleProblem(badBranch, { ...known, fieldTypes: new Map([['status', 'text'], ['go', 'button']]) })).toMatch(/"ghost" is not an input/)
  })

  it('the test panel simulates an answer: the chosen branch shows and No stops the rest', () => {
    const all = simulateRuleEvent(def, { type: 'before_submit', target: 'submit', context: { button: 'submit' } }, { values: {} })
    expect(all.find((r) => r.key === 'rules:confirm')!.actions[0]).toBe('Ask “Submit now?” — Yes → continue; No → Banner: “Not sent”, stop')
    const no = simulateRuleEvent(def, { type: 'before_submit', target: 'submit' }, { values: {} }, { response: 'no' })
    expect(no.find((r) => r.key === 'rules:confirm')!.actions).toEqual(['Ask “Submit now?” — answered No → Banner: “Not sent”, stop', '(the rest stops here)'])
    const answered = simulateRuleEvent(def, { type: 'message_answered', target: 'sure', context: { message: 'sure', response: 'no' } }, { values: {} })
    expect(answered.find((r) => r.key === 'rules:answered')).toMatchObject({ triggered: true, met: true, actions: ['Set Status = draft'] })
  })

  it('renaming a field renames it inside branches too', () => {
    const r = normalizeFormRules([{ id: 'r', event: 'button_click', target: 'go', then: [{ type: 'prompt', prompt: { preset: 'ok', buttons: [{ value: 'ok', then: [{ type: 'clear_values', fields: ['status'] }] }] } }] }])[0]
    expect(renameRuleKey(r, 'status', 'state').then[0].prompt!.buttons[0].then).toEqual([{ type: 'clear_values', fields: ['state'] }])
  })
})

describe('portability: export / import / versions / API carry the options', () => {
  it('a layout round trip keeps message options, questions and branches; ids inside branches are dependencies and remapped', () => {
    const keys = ['status']
    const raw = {
      rows: [{ columns: 1, cells: [{ field_key: 'status', span: 1 }] }],
      rules: [{
        id: 'r1', event: 'button_click', target: 'go',
        then: [
          { type: 'message', text: 'Hello', title: 'Hi', tone: 'warning', style: 'banner', duration: 'auto', seconds: 8 },
          { type: 'prompt', text: 'Start it?', prompt: { id: 'go_q', display: 'dialog', preset: 'yes_no', escape: 'no', buttons: [{ value: 'yes', label: 'Start', then: [{ type: 'start_workflow', workflow_id: u(5) }], continue: true }] } },
        ],
      }],
    }
    const layout = normalizeFormLayout(raw, keys)!
    const saved = JSON.parse(JSON.stringify(compactLayoutForSave(layout, keys)))
    const again = normalizeFormLayout(saved, keys)!
    expect(again.rules).toEqual(layout.rules)
    expect(again.rules![0].then[0]).toEqual({ type: 'message', text: 'Hello', title: 'Hi', tone: 'warning', style: 'banner', duration: 'auto', seconds: 8 })
    expect(again.rules![0].then[1].prompt).toMatchObject({ id: 'go_q', display: 'dialog', escape: 'no', buttons: [{ value: 'yes', label: 'Start', continue: true }, { value: 'no', label: 'No' }] })

    const form = { id: u(60), name: 'F', fields: [], layout: saved }
    expect(scanAssetReferences(form).refs).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'workflow', id: u(5) })]))
    const maps = createEmptyAssetIdMaps()
    maps.workflow[u(5)] = u(6)
    const out = remapKnownIds(form, maps) as any
    expect(out.layout.rules[0].then[1].prompt.buttons[0].then[0].workflow_id).toBe(u(6))
  })

  it('Button configs (task forms, versions) keep questions; old buttons are unchanged', () => {
    const cfg = normalizeFieldButton({ style: 'danger', actions: [{ type: 'prompt', text: 'Delete?', prompt: { preset: 'yes_no', buttons: [{ value: 'yes', then: [{ type: 'apply_table_changes', table_changes: { field: 'rows', target: 'table', operation: 'auto' } }], continue: true }] } }] })
    expect(cfg.actions[0].prompt!.buttons[0].then![0].type).toBe('apply_table_changes')
    // A Button's branches only take Button actions (rule-only ones are dropped).
    expect(normalizeFieldButton({ style: 'primary', actions: [{ type: 'prompt', prompt: { preset: 'ok', buttons: [{ value: 'ok', then: [{ type: 'start_workflow', workflow_id: u(5) }] }] } }] }).actions[0].prompt!.buttons[0].then).toBeUndefined()
    expect(normalizeFieldButton({ style: 'primary', actions: [{ type: 'message', text: 'Hi' }] }).actions).toEqual([{ type: 'message', text: 'Hi' }])
  })
})

describe('server safety: a forged response reaches only what the saved form declares', () => {
  const layout = { rules: [{ id: 'del', event: 'button_click', target: 'go', then: [
    { type: 'message', text: 'x' },
    { type: 'prompt', prompt: { preset: 'yes_no', buttons: [{ value: 'yes', then: [{ type: 'print' }, { type: 'apply_table_changes', table_changes: { field: 'rows', target: 'table', operation: 'auto' } }], continue: true }] } },
  ] }] }

  it('declared branch steps are found; other responses, indexes and client-only steps are not', () => {
    expect(findServerRuleAction(layout, 'del', 1, { response: 'yes', index: 1 })?.action.type).toBe('apply_table_changes')
    expect(findServerRuleAction(layout, 'del', 1, { response: 'no', index: 1 })).toBeNull() // No has no such step
    expect(findServerRuleAction(layout, 'del', 1, { response: 'maybe', index: 0 })).toBeNull() // not a button of the question
    expect(findServerRuleAction(layout, 'del', 1, { response: 'yes', index: 0 })).toBeNull() // print is client-only
    expect(findServerRuleAction(layout, 'del', 1, { response: 'yes', index: 9 })).toBeNull()
    expect(findServerRuleAction(layout, 'del', 0, { response: 'yes', index: 1 })).toBeNull() // not a question
    expect(findServerRuleAction(layout, 'del', 1)).toBeNull() // the question itself is not a server step
  })

  it('a Button step inside a branch is found the same way (Apply table changes endpoint)', () => {
    const cfg = normalizeFieldButton({ style: 'danger', actions: [{ type: 'prompt', prompt: { preset: 'yes_no', buttons: [{ value: 'yes', then: [{ type: 'apply_table_changes', table_changes: { field: 'rows', target: 'table', operation: 'auto' } }] }] } }] })
    expect(actionAt(cfg.actions, 0, { response: 'yes', index: 0 })?.type).toBe('apply_table_changes')
    expect(actionAt(cfg.actions, 0, { response: 'no', index: 0 })).toBeNull()
    expect(actionAt(cfg.actions, 0)?.type).toBe('prompt')
  })

  it('what an answer can set counts toward the state bound (and nothing more); a branch Submit makes a submit path', () => {
    const fields = normalizeTaskFields([
      { key: 'secret', label: 'Secret', type: 'text', required: true },
      { key: 'go', label: 'Go', type: 'button', button: { style: 'primary', actions: [{ type: 'prompt', prompt: { preset: 'yes_no', buttons: [{ value: 'yes', then: [{ type: 'show_hide', mode: 'hide', targets: ['field:secret'] }, { type: 'submit' }] }] } }] } },
    ])
    const ok = sanitizeFormState(fields, { rows: [] }, { [FORM_STATE_KEY]: { flags: {}, hidden: ['field:secret', 'field:go'] } })
    expect(ok.hidden).toEqual(['field:secret'])
    expect(submittingButtonKeys(fields)).toEqual(['go'])
    expect(allActions(fields[1].button!.actions).map((a) => a.type)).toEqual(['prompt', 'show_hide', 'submit'])
  })
})

describe('accessibility checker', () => {
  it('warns about auto-hide under 5 seconds and questions without an accessible name', () => {
    const rule = STRUCTURAL_RULES.find((r) => r.info.rule === 'form-messages')!
    const fields = normalizeTaskFields([{ key: 'go', label: 'Go', type: 'button', button: { style: 'primary', actions: [{ type: 'message', text: 'Quick', style: 'banner', duration: 'auto', seconds: 3 }] } }])
    const layout = { rows: [], rules: [{ id: 'q', name: 'Ask', event: 'form_load', then: [{ type: 'prompt', text: '{{name}}', prompt: { preset: 'ok' } }, { type: 'message', text: 'Fine', style: 'banner', duration: 'auto', seconds: 8 }] }] }
    const findings = rule.run({ def: { fields, layout, theme: { source: 'workspace' }, buttons: null, header: null }, opts: {} } as any)
    expect(findings.map((f) => [f.severity, f.wcag[0], f.field_key ?? null])).toEqual([['serious', '4.1.2', null], ['moderate', '2.2.1', 'go']])
  })
})
