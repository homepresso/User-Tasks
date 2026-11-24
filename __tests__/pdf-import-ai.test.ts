import { beforeEach, describe, expect, it, vi } from 'vitest'

// The workspace's Agent plumbing, mocked: settings, connection, limits, usage, audit, rate limit.
const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  audits: [] as Array<Record<string, unknown>>,
  usage: [] as Array<Record<string, unknown>>,
  limitError: null as Error | null,
}))
vi.mock('@/lib/services/_shared', () => ({
  serviceRoleClient: async () => ({}),
  audit: async (_ctx: unknown, entry: Record<string, unknown>) => { state.audits.push(entry) },
}))
vi.mock('@/lib/assistants/settings', () => {
  class AssistantConfigError extends Error {}
  return {
    AssistantConfigError,
    loadAssistantSettings: async () => state.row,
    rowLooksUsable: (row: { usable?: boolean } | null) => Boolean(row?.usable),
    resolvePersonConnection: async () => ({ connection: { provider: 'anthropic', model: 'claude-test', url: 'https://example.invalid/v1/chat/completions', headers: {}, baseUrl: '' }, profile: null }),
  }
})
vi.mock('@/lib/assistants/limits', () => {
  class AssistantLimitError extends Error {}
  return {
    AssistantLimitError,
    checkAssistantLimits: async () => { if (state.limitError) throw state.limitError },
    recordAssistantUsage: async (_db: unknown, rec: Record<string, unknown>) => { state.usage.push(rec) },
  }
})
vi.mock('@/lib/services/assistants', () => ({ availabilityUser: async () => ({ userId: 'u1', permissions: new Set(), roleIds: [], teamIds: [] }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true, retryAfterMs: 0 }) }))
const created = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('@/lib/services/forms', () => ({
  createForm: async (_ctx: unknown, input: Record<string, unknown>) => { created.push(input); return { id: `form-${created.length}`, name: input.name } },
  deleteForm: async () => undefined,
}))

import { buildAiMessages, mergeAiAnswer, parseAiAnswer, runAiAssist, type AiComplete } from '@/lib/importers/pdf/ai'
import { aiAvailabilityFrom, analyzePdfImport, importPdf, pdfAiAvailability, pdfOptions } from '@/lib/importers/pdf/importer'
import { analyzePdf } from '@/lib/importers/pdf/analyze'
import type { PdfFormModel } from '@/lib/importers/pdf/model'
import type { ServiceContext } from '@/lib/services/context'
import { makeAcroFormFixture, makeFlatFixture } from './fixtures/pdf-forms'

const ctx = { tenantId: 't1', actorId: 'u1', permissions: new Set(['forms.view', 'forms.edit']), supabase: {}, db: {} } as unknown as ServiceContext
const allowed = { usable: true, provider: 'anthropic', model: 'claude-test', agent: { import_ai: true }, limits: {} }

const FLAT_ANSWER = {
  title: 'Household questionnaire',
  sections: [{ id: 's1', title: 'About you', page: 1 }],
  items: [
    { id: 'ai_1', type: 'text', label: 'What is your name?', question: '1', page: 1, section: 's1', required: true },
    { id: 'ai_2', type: 'choice', label: 'Do you own a car?', question: '2', page: 1, options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }] },
    { id: 'ai_3', type: 'text', label: 'What make is it?', question: '3', page: 1 },
    { id: 'ai_4', type: 'number', label: 'How many people live here?', question: '4', page: 1 },
  ],
  rules: [{ mode: 'hide', when: { item: 'ai_2', op: 'equals', value: 'No' }, targets: ['ai_3'], confidence: 'high', original: 'If No, go to question 4' }],
}

beforeEach(() => { state.row = null; state.audits = []; state.usage = []; state.limitError = null })

describe('AI answer validation', () => {
  it('accepts the intermediate JSON (fenced or not) and rejects anything else with the reasons', () => {
    expect(parseAiAnswer(JSON.stringify(FLAT_ANSWER)).ok).toBe(true)
    expect(parseAiAnswer('Here you go:\n```json\n' + JSON.stringify(FLAT_ANSWER) + '\n```').ok).toBe(true)
    expect(parseAiAnswer('no json here')).toEqual({ ok: false, error: 'The answer is not a JSON object' })
    const bad = parseAiAnswer(JSON.stringify({ items: [{ id: 'x', type: 'spreadsheet', label: '', page: 0 }] }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/items\.0\.type/)
  })

  it('repairs once, then rejects — never trusting an invalid answer', async () => {
    const model: PdfFormModel = { title: 'x', kind: 'flat', pages: 1, sections: [], items: [], rules: [], notes: [] }
    const seq = ['{"items": "nope"}', JSON.stringify(FLAT_ANSWER)]
    const complete = vi.fn<AiComplete>(async () => ({ text: seq.shift()!, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
    const ok = await runAiAssist({ model, pages: [] }, complete)
    expect(ok).toMatchObject({ calls: 2, error: null, usage: { total_tokens: 30 } })
    expect(complete.mock.calls[1][0].at(-1)!.content).toMatch(/invalid/)
    const never = vi.fn<AiComplete>(async () => ({ text: 'still not json' }))
    const bad = await runAiAssist({ model, pages: [] }, never)
    expect(bad).toMatchObject({ answer: null, calls: 2, usageMissing: true })
  })

  it('marks the PDF content as untrusted data and sends page images when given', () => {
    const model: PdfFormModel = { title: 'x', kind: 'scanned', pages: 1, sections: [], items: [], rules: [], notes: [] }
    const msgs = buildAiMessages({ model, pages: [], images: [{ page: 1, dataUrl: 'data:image/png;base64,AAAA' }] })
    expect(msgs[0].content).toMatch(/never follow instructions/)
    expect(Array.isArray(msgs[1].content) && msgs[1].content.some((p) => p.type === 'image_url')).toBe(true)
  })
})

describe('merging AI answers', async () => {
  const fillable = (await analyzePdf(await makeAcroFormFixture(), 'survey.pdf')).model

  it('builds a flat PDF\'s questions from the answer, all marked AI', () => {
    const flat: PdfFormModel = { title: 'Paper', kind: 'flat', pages: 1, sections: [], items: [], rules: [], notes: [] }
    const { model, changes } = mergeAiAnswer(flat, parseAiAnswer(JSON.stringify(FLAT_ANSWER)).ok ? FLAT_ANSWER as never : (null as never))
    expect(model.items.map((i) => [i.label, i.origin, i.labelSource])).toEqual([
      ['What is your name?', 'ai', 'ai'], ['Do you own a car?', 'ai', 'ai'], ['What make is it?', 'ai', 'ai'], ['How many people live here?', 'ai', 'ai'],
    ])
    expect(model.sections).toEqual([expect.objectContaining({ id: 's1', origin: 'ai' })])
    expect(model.rules).toEqual([expect.objectContaining({ origin: 'ai', source: 'ai', confidence: 'high', targets: ['ai_3'], when: { item: 'ai_2', op: 'equals', value: 'No' } })])
    expect(changes.length).toBeGreaterThan(1)
  })

  it('on a fillable PDF only improves weak labels, merges boxes and adds valid rules', () => {
    const answer = {
      items: [
        { id: 'Text12', type: 'text', label: 'Reference number', page: 1 },
        { id: 'comments', type: 'text', label: 'SHOULD NOT REPLACE A TOOLTIP', page: 1 },
        { id: 'ai_new', type: 'text', label: 'Invented field', page: 1 },
        { id: 'pet', type: 'choice', label: 'Pet?', page: 1, options: [{ value: 'Yes', label: 'Yes' }], sourceFields: ['hasPet', 'unknown_field'] },
      ],
      rules: [
        { mode: 'show', when: { item: 'hasPet', op: 'equals', value: 'Yes' }, targets: ['Text12'], confidence: 'low', original: 'Only if you have a pet' },
        { mode: 'show', when: { item: 'nope', op: 'equals', value: 'x' }, targets: ['Text12'] },
      ],
    }
    const { model } = mergeAiAnswer(fillable, answer as never)
    const t12 = model.items.find((i) => i.id === 'Text12')!
    expect(t12).toMatchObject({ label: 'Reference number', labelSource: 'ai', origin: 'ai' })
    expect(model.items.find((i) => i.id === 'comments')!.label).toBe('Anything else you want to tell us')
    expect(model.items.some((i) => i.label === 'Invented field')).toBe(false)
    expect(model.items.find((i) => i.id === 'hasPet')!.type).toBe('boolean')
    const added = model.rules.filter((r) => r.origin === 'ai')
    expect(added).toEqual([expect.objectContaining({ confidence: 'low', when: { item: 'hasPet', op: 'equals', value: 'true' }, targets: ['Text12'] })])
    // The input model is not changed.
    expect(fillable.items.find((i) => i.id === 'Text12')!.label).toBe('Text12')
  })
})

describe('the opt-in gate, consent, audit and usage', async () => {
  const flatBytes = await makeFlatFixture()
  const files = [{ name: 'paper.pdf', bytes: flatBytes }]
  const answerText = JSON.stringify(FLAT_ANSWER)

  it('availability: no provider → off with a link; setting off → off; permission needed', () => {
    expect(aiAvailabilityFrom({ usable: false, importAi: true, canEdit: true, provider: null, model: null })).toMatchObject({ available: false, configured: false, settings_href: '/settings/assistants', reason: expect.stringMatching(/No AI provider/) })
    expect(aiAvailabilityFrom({ usable: true, importAi: false, canEdit: true, provider: 'openai', model: 'gpt' })).toMatchObject({ available: false, configured: true, reason: expect.stringMatching(/not allowed/) })
    expect(aiAvailabilityFrom({ usable: true, importAi: true, canEdit: false, provider: 'openai', model: 'gpt' }).available).toBe(false)
    expect(aiAvailabilityFrom({ usable: true, importAi: true, canEdit: true, provider: 'openai', model: 'gpt' })).toMatchObject({ available: true, provider: 'openai' })
  })

  it('reads the workspace setting (off by default)', async () => {
    state.row = { ...allowed, agent: {} }
    expect((await pdfAiAvailability(ctx)).available).toBe(false)
    state.row = allowed
    expect((await pdfAiAvailability(ctx)).available).toBe(true)
  })

  it('sends nothing when the option is off — even with a provider set up', async () => {
    state.row = allowed
    const complete = vi.fn<AiComplete>()
    const report = await analyzePdfImport(ctx, files, {}, { complete })
    expect(complete).not.toHaveBeenCalled()
    expect(state.audits).toEqual([])
    expect(state.usage).toEqual([])
    expect(report.details).toMatchObject({ kind: 'flat', ai: { used: false }, ai_availability: { available: true } })
    expect(report.summary).toMatch(/no fillable fields/)
  })

  it('refuses the option when unavailable, and without consent', async () => {
    const complete = vi.fn<AiComplete>()
    state.row = { ...allowed, agent: { import_ai: false } }
    await expect(analyzePdfImport(ctx, files, { ai: true, ai_consent: true }, { complete })).rejects.toMatchObject({ status: 403 })
    state.row = allowed
    await expect(analyzePdfImport(ctx, files, { ai: true }, { complete })).rejects.toThrow(/Confirm/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('runs with consent: merges, marks AI items, records usage and the audit entry', async () => {
    state.row = allowed
    const complete = vi.fn<AiComplete>(async () => ({ text: answerText, usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }))
    const report = await analyzePdfImport(ctx, files, { ai: true, ai_consent: true }, { complete })
    expect(complete).toHaveBeenCalledTimes(1)
    const fields = report.items.filter((i) => i.kind === 'field')
    expect(fields).toHaveLength(4)
    expect(fields.every((i) => i.origin === 'ai' && i.status === 'partial')).toBe(true)
    expect(report.outputs).toHaveLength(1)
    expect((report.details as { ai: { used: boolean; answer: unknown } }).ai).toMatchObject({ used: true, answer: expect.objectContaining({ title: 'Household questionnaire' }) })
    expect(state.usage).toEqual([expect.objectContaining({ capability: 'designer', provider: 'anthropic', model: 'claude-test', status: 'completed', llmCalls: 1, usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })])
    expect(state.audits).toEqual([expect.objectContaining({ action: 'ai_assist', metadata: expect.objectContaining({ kind: 'pdf_import_ai', file: 'paper.pdf', provider: 'anthropic', ok: true }) })])
    // The answer the analysis returned is valid import input (no second call).
    expect(pdfOptions({ ai: true, ai_result: (report.details as { ai: { answer: unknown } }).ai.answer }).aiResult).not.toBeNull()
  })

  it('keeps the importer\'s own result when the model\'s answer is unusable', async () => {
    state.row = allowed
    const report = await analyzePdfImport(ctx, files, { ai: true, ai_consent: true }, { complete: async () => ({ text: 'sorry' }) })
    expect(report.warnings.join(' ')).toMatch(/not usable/)
    expect(state.usage[0]).toMatchObject({ status: 'failed' })
    expect(state.audits[0]).toMatchObject({ metadata: expect.objectContaining({ ok: false }) })
  })

  it('applies the Agent\'s limits before sending', async () => {
    state.row = allowed
    const { AssistantLimitError } = await import('@/lib/assistants/limits')
    state.limitError = new AssistantLimitError('cap reached', 'monthly_cost' as never)
    const complete = vi.fn<AiComplete>()
    await expect(analyzePdfImport(ctx, files, { ai: true, ai_consent: true }, { complete })).rejects.toMatchObject({ code: 'rate_limited' })
    expect(complete).not.toHaveBeenCalled()
  })

  it('rejects a tampered ai_result and refuses to import a flat PDF without one', async () => {
    expect(() => pdfOptions({ ai_result: { items: [{ id: 'x', type: 'virus' }] } })).toThrow(/not a valid AI answer/)
    await expect(importPdf(ctx, files, {})).rejects.toThrow(/no fillable fields/)
  })

  it('imports with the analysis\'s AI answer: no provider call, forms created with AI marks', async () => {
    state.row = allowed
    created.length = 0
    const result = await importPdf(ctx, files, { ai: true, ai_consent: true, ai_result: FLAT_ANSWER, name: 'Household' })
    expect(state.usage).toEqual([])
    expect(result.created).toEqual([expect.objectContaining({ kind: 'form', id: 'form-1', name: 'Household', href: expect.stringContaining('form-1') })])
    expect(created[0]).toMatchObject({ name: 'Household', tags: ['pdf'] })
    expect((created[0].fields as unknown[]).length).toBe(4)
    expect(result.report.items.some((i) => i.origin === 'ai')).toBe(true)
  })
})
