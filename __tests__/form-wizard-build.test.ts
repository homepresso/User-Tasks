/**
 * The form wizard's spec and builders (lib/forms/wizard): spec validation,
 * question → field / column per kind, "show only if" → Always show rules,
 * layouts, the workflow per approval mode (checked with the designer's
 * validation and the gallery package validator), reports, quiz scoring and
 * the results page's charts / summary.
 */
import { describe, expect, it } from 'vitest'
import {
  WizardSpecSchema, wizardSpecProblems, QUESTION_KINDS, OPTION_KINDS, type WizardSpec, type WizardSpecInput,
} from '@/lib/forms/wizard/spec'
import {
  SYSTEM_COLUMNS, assignWizardKeys, buildFormFields, buildFormInput, buildFormLayout, buildReports, buildTableColumns,
  buildWorkflow, mergeTableColumns, questionField, reviewFields, scoreExpression, scoreOf, wizardPlan, STATUS,
} from '@/lib/forms/wizard/build'
import { WIZARD_TEMPLATE_ORDER, specFromTemplate } from '@/lib/forms/wizard/templates'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { fieldDefinitionProblems, normalizeTaskFields } from '@/lib/task-field-schema'
import { validateWorkflow } from '@/lib/workflow-validation'
import { validateGallerySource } from '@/lib/gallery/validate'
import { readAllGallerySources } from '@/lib/gallery/source'
import { alwaysRuleEffects } from '@/lib/forms/form-rules'
import { resolveExpression } from '@/lib/expression-resolver'
import { wizardCharts, wizardSummary, questionsFromAi } from '@/lib/services/form-wizard'
import { responsePolicyProblem } from '@/lib/services/form-wizard-policy'

/* eslint-disable @typescript-eslint/no-explicit-any -- built objects are checked as JSON */

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const T1 = '33333333-3333-4333-8333-333333333333'
const REFS = { formId: '44444444-4444-4444-8444-444444444444', formName: 'Purchase request', tableId: '55555555-5555-4555-8555-555555555555', tableName: 'Purchase request responses' }

function spec(input: Partial<WizardSpecInput> = {}): WizardSpec {
  return assignWizardKeys(WizardSpecSchema.parse({
    name: 'Purchase request',
    questions: [
      { id: 'q1', kind: 'short_text', label: 'What do you need?', required: true },
      { id: 'q2', kind: 'money', label: 'Cost', currency: 'NZD' },
      { id: 'q3', kind: 'choice', label: 'Category', options: ['Hardware', 'Software'] },
      { id: 'q4', kind: 'long_text', label: 'Software details', show_if: { question: 'q3', op: 'is', value: 'Software' } },
    ],
    ...input,
  }))
}

const allKinds = (): WizardSpec => spec({
  questions: QUESTION_KINDS.map((kind, i) => ({
    id: `k${i}`, kind, label: `Question ${kind}`,
    ...(OPTION_KINDS.has(kind) ? { options: ['A', 'B'] } : {}),
    ...(kind === 'matrix' ? { rows: ['Speed', 'Price'] } : {}),
  })),
})

describe('wizard spec validation', () => {
  it('accepts every template as a starting point', () => {
    for (const t of WIZARD_TEMPLATE_ORDER) expect(wizardSpecProblems(specFromTemplate(t).spec), t).toBeNull()
  })

  it('refuses unusable specs with plain messages', () => {
    expect(wizardSpecProblems({ name: '', questions: [] })?.join('\n')).toMatch(/Give it a name[\s\S]*at least one question/)
    expect(wizardSpecProblems({ name: 'X', questions: [{ id: 'a', kind: 'heading', label: 'Only a heading' }] })?.join()).toMatch(/question people answer/)
    expect(wizardSpecProblems({ name: 'X', questions: [{ id: 'a', kind: 'choice', label: 'Pick' }] })?.join()).toMatch(/needs at least one option/)
    expect(wizardSpecProblems({ name: 'X', questions: [{ id: 'a', kind: 'text', label: 'Pick' }] })).not.toBeNull()
    // A condition must point at an earlier question.
    expect(wizardSpecProblems({ name: 'X', questions: [{ id: 'a', kind: 'short_text', label: 'A', show_if: { question: 'b', op: 'answered' } }, { id: 'b', kind: 'short_text', label: 'B' }] })?.join()).toMatch(/question before it/)
    // Quiz answers must be options.
    expect(wizardSpecProblems({ name: 'X', questions: [{ id: 'a', kind: 'choice', label: 'A', options: ['x'], score: { correct: ['y'] } }] })?.join()).toMatch(/one of its options/)
    // Approvals need the right approver kind and stage count.
    expect(wizardSpecProblems({ name: 'X', questions: [{ id: 'a', kind: 'short_text', label: 'A' }], approval: { mode: 'multi', stages: [{ id: 's1', name: 'Approve', assignee: { kind: 'person', user_id: U1 } }] } })?.join()).toMatch(/2 to 5 stages/)
    expect(wizardSpecProblems({ name: 'X', questions: [{ id: 'a', kind: 'short_text', label: 'A' }], approval: { mode: 'single', stages: [{ id: 's1', name: 'Approve', assignee: { kind: 'team', team_id: T1 } }] } })?.join()).toMatch(/needs person/)
    expect(wizardSpecProblems({ name: 'X', questions: [{ id: 'a', kind: 'short_text', label: 'A' }], audience: { internal: false, public_link: false } })?.join()).toMatch(/who fills it in/)
  })
})

describe('questions → fields and columns', () => {
  it('maps every kind to a valid field and a typed column', () => {
    const s = allKinds()
    const fields = buildFormFields(s)
    expect(fieldDefinitionProblems(normalizeTaskFields(fields))).toEqual({})
    const byKind = Object.fromEntries(s.questions.map((q) => [q.kind, questionField(q)?.type ?? null]))
    expect(byKind).toEqual({
      short_text: 'text', long_text: 'textarea', number: 'number', money: 'currency', date: 'date', choice: 'choice', choices: 'multi_choice',
      rating: 'rating', nps: 'nps', yes_no: 'choice', email: 'email', phone: 'phone', file: 'attachments', heading: 'heading', page_break: null,
      likert: 'likert', matrix: 'matrix', slider: 'slider', csat: 'csat', ranking: 'ranking', image_choice: 'image_choice', yes_no_maybe: 'yes_no_maybe',
    })
    const cols = Object.fromEntries(buildTableColumns(s).map((c) => [c.key, c.type]))
    const key = (kind: string) => s.questions.find((q) => q.kind === kind)!.key!
    expect([cols[key('rating')], cols[key('nps')], cols[key('money')], cols[key('choice')], cols[key('file')], cols[key('long_text')]]).toEqual(['number', 'number', 'number', 'select', 'file', 'longtext'])
    expect(cols[key('heading')]).toBeUndefined()
    // Survey kinds: numbers for scores, selects for single answers, text for a ranking; a grid gets a column per statement.
    expect([cols[key('slider')], cols[key('csat')], cols[key('likert')], cols[key('yes_no_maybe')], cols[key('image_choice')], cols[key('ranking')]]).toEqual(['number', 'number', 'select', 'select', 'select', 'text'])
    expect(cols[key('matrix')]).toBeUndefined()
    expect([cols[`${key('matrix')}_speed`], cols[`${key('matrix')}_price`]]).toEqual(['select', 'select'])
    // System columns, never a question key.
    for (const c of ['reference', 'submitted_by', 'submitted_at', 'status', 'submission_id']) expect(cols[c]).toBeDefined()
    expect(cols.decided_by).toBeUndefined() // no review
  })

  it('keys are kept, unique, and never a system column', () => {
    const s = assignWizardKeys(WizardSpecSchema.parse({ name: 'X', questions: [
      { id: 'a', kind: 'short_text', label: 'Status' }, { id: 'b', kind: 'short_text', label: 'Status' }, { id: 'c', kind: 'short_text', label: 'Kept', key: 'my_key' },
    ] }))
    const keys = s.questions.map((q) => q.key)
    expect(keys[0]).not.toBe('status')
    expect(new Set(keys).size).toBe(3)
    expect(keys[2]).toBe('my_key')
    expect(SYSTEM_COLUMNS.map((c) => c.key)).not.toContain(keys[0])
  })

  it('an update merges columns: nothing dropped or retyped, new ones appended, options widened', () => {
    const before = [{ key: 'what', name: 'What', type: 'text' }, { key: 'cat', name: 'Category', type: 'select', options: ['A'] }, { key: 'old', name: 'Old question', type: 'number' }]
    const next = [{ key: 'what', name: 'What exactly', type: 'text' }, { key: 'cat', name: 'Category', type: 'select', options: ['A', 'B'] }, { key: 'new', name: 'New', type: 'date' }]
    expect(mergeTableColumns(before, next)).toEqual([
      { key: 'what', name: 'What exactly', type: 'text' }, { key: 'cat', name: 'Category', type: 'select', options: ['A', 'B'] },
      { key: 'old', name: 'Old question', type: 'number' }, { key: 'new', name: 'New', type: 'date' },
    ])
  })
})

describe('form layout and rules', () => {
  it('"show only if" becomes an Always show rule the rules engine applies', () => {
    const s = spec()
    const layout = buildFormLayout(s)
    expect(layout.rules).toHaveLength(1)
    const rule = layout.rules![0]
    expect(rule).toMatchObject({ event: 'always', if: { match: 'all', conditions: [{ column: s.questions[2].key, operator: 'eq', value: 'Software' }] }, then: [{ type: 'show_hide', mode: 'show', targets: [`field:${s.questions[3].key}`] }] })
    const def = normalizeFormDefinition({ fields: buildFormFields(s), layout })
    expect(def.layout?.rules).toHaveLength(1)
    const hidden = (values: Record<string, unknown>) => alwaysRuleEffects(def.layout, values).hidden
    expect(hidden({ [s.questions[2].key!]: 'Hardware' })).toContain(`field:${s.questions[3].key}`)
    expect(hidden({ [s.questions[2].key!]: 'Software' })).not.toContain(`field:${s.questions[3].key}`)
  })

  it('steps at page breaks, one question per step, a single page otherwise', () => {
    const questions = [
      { id: 'h', kind: 'heading' as const, label: 'About you' }, { id: 'a', kind: 'short_text' as const, label: 'Name' },
      { id: 'p', kind: 'page_break' as const, label: 'Break' }, { id: 'b', kind: 'email' as const, label: 'Email' }, { id: 'c', kind: 'phone' as const, label: 'Phone' },
    ]
    const steps = buildFormLayout(spec({ questions, look: { layout: 'steps' } }))
    expect(steps.mode).toBe('steps')
    expect(steps.pages!.map((p) => [p.title, p.rows.length])).toEqual([['About you', 2], ['Step 2', 2]])
    const one = buildFormLayout(spec({ questions, look: { layout: 'one_at_a_time' } }))
    expect(one.pages!.map((p) => p.rows.length)).toEqual([2, 1, 1])
    const single = buildFormLayout(spec({ questions }))
    expect(single.mode).toBeUndefined()
    expect(single.rows).toHaveLength(4)
    expect(single.submitted_page).toMatchObject({ enabled: true, submit_another: { enabled: true } })
    // One question per step: a conditional question hides its own step too.
    const cond = buildFormLayout(spec({ look: { layout: 'one_at_a_time' } }))
    expect(cond.rules![0].then[0].targets).toEqual([expect.stringMatching(/^field:/), 'page:page_4'])
  })

  it('the form input carries the theme, header and a single Submit button', () => {
    const input = buildFormInput(spec({ look: { theme: { kind: 'accent', color: '#0f766e' }, header: { show: true, logo: false, title: 'Buy things' } } }))
    expect(input.theme).toEqual({ source: 'custom', overrides: { colors: { light: { accent: '#0f766e' }, dark: { accent: '#0f766e' } } } })
    expect(input.header).toMatchObject({ enabled: true, image: 'none', title: 'Buy things' })
    expect(input.buttons).toEqual([{ id: 'submit', label: 'Submit', kind: 'submit', style: 'primary' }])
    expect(input.tags).toEqual(['wizard'])
  })
})

/** Validate a generated workflow like the designer and a gallery package would. */
function checkWorkflow(s: WizardSpec) {
  const wf = buildWorkflow(s, REFS)
  const result = validateWorkflow(wf.nodes as any, wf.trigger_type)
  expect(result.nodeErrors).toEqual([])
  const base = readAllGallerySources().find((x) => x.slug === 'risk-register')!
  const table = { id: REFS.tableId, name: REFS.tableName, columns: buildTableColumns(s).map((c, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, ...c })) }
  const form = { id: REFS.formId, ...buildFormInput(s) }
  const source = {
    ...base, meta: { ...structuredClone(base.meta), entry_workflow: '66666666-6666-4666-8666-666666666666' },
    manifest: { forms: [form], data_tables: [table], workflows: [{ id: '66666666-6666-4666-8666-666666666666', ...wf, is_active: true }] },
    paths: {}, controls: [], errors: [],
  }
  const issues = validateGallerySource(source as any).filter((i) => !i.path.endsWith('gallery.json')) // the package's listing is not ours
  expect(issues).toEqual([])
  return wf
}

describe('workflow per approval mode', () => {
  it('no review: Form submitted → save the row (Submitted) → end', () => {
    const wf = checkWorkflow(spec())
    expect(wf.nodes.map((n) => n.type)).toEqual(['form_submitted', 'update_data_table', 'end_workflow'])
    expect(wf.nodes[0].config).toEqual({ form_id: REFS.formId, form_name: REFS.formName })
    expect(wf.nodes[1].config).toMatchObject({ operation: 'insert', table_id: REFS.tableId, output_row_id_var: 'response_row_id', column_values: { status: STATUS.submitted, reference: '{{submission.reference}}' } })
  })

  it('single approver: a task with the answers read only, Approve / Decline write back and email', () => {
    const s = spec({ approval: { mode: 'single', stages: [{ id: 's1', name: 'Approval', assignee: { kind: 'person', user_id: U1 } }] } })
    const wf = checkWorkflow(s)
    const task = wf.nodes.find((n) => n.type === 'user_task')!
    expect(task.config).toMatchObject({ assignment_type: 'individual', assignee_id: U1, outcomes: ['Approve', 'Decline'], due_offset_amount: 3 })
    const fields = task.config.fields as any[]
    expect(fields.filter((f) => f.read_only).map((f) => f.default)).toContain(`{{form.${s.questions[0].key}}}`)
    expect(fields.at(-1)).toMatchObject({ key: 'review_note', type: 'textarea' })
    const out = wf.edges.filter((e) => e.source === task.id).map((e) => e.label).sort()
    expect(out).toEqual(['Approve', 'Decline'])
    const approved = wf.nodes.find((n) => n.id === 'approved')!
    expect(approved.config).toMatchObject({ operation: 'update', row_id: '{{response_row_id}}', column_values: { status: STATUS.approved, decided_by: '{{actioned_by_name}}' } })
    expect(wf.nodes.filter((n) => n.type === 'send_email')).toHaveLength(2)
  })

  it("manager: the requester's manager from reporting lines, else the fallback person", () => {
    const wf = checkWorkflow(spec({ approval: { mode: 'manager', notify_requester: false, stages: [{ id: 's1', name: 'Manager approval', assignee: { kind: 'manager', fallback_user_id: U2 }, outcomes: ['approve', 'decline', 'changes'] }] } }))
    const lookup = wf.nodes.find((n) => n.type === 'set_variable')!
    expect(lookup.config.expression).toBe(`{{=COALESCE(submitted_by_manager_id, "${U2}")}}`)
    expect(resolveExpression(lookup.config.expression as string, { variables: { submitted_by_manager_id: 'boss' } } as any)).toBe('boss')
    expect(resolveExpression(lookup.config.expression as string, { variables: { submitted_by_manager_id: null } } as any)).toBe(U2)
    expect(wf.nodes.find((n) => n.type === 'user_task')!.config).toMatchObject({ assignee_variable: '{{approver_id}}', outcomes: ['Approve', 'Decline', 'Ask for changes'] })
    expect(wf.nodes.some((n) => n.type === 'send_email')).toBe(false)
  })

  it('team: a claimable team task', () => {
    const wf = checkWorkflow(spec({ approval: { mode: 'team', stages: [{ id: 's1', name: 'Triage', assignee: { kind: 'team', team_id: T1 } }] } }))
    expect(wf.nodes.find((n) => n.type === 'user_task')!.config).toMatchObject({ assignment_type: 'team', team_id: T1 })
  })

  it('multi-stage: review then approve, stage written back, each stage branches on its own', () => {
    const s = spec({ approval: { mode: 'multi', stages: [
      { id: 's1', name: 'Review', assignee: { kind: 'team', team_id: T1 }, outcomes: ['approve', 'changes'] },
      { id: 's2', name: 'Approve', assignee: { kind: 'person', user_id: U1 }, outcomes: ['approve', 'decline'] },
    ] } })
    const wf = checkWorkflow(s)
    const tasks = wf.nodes.filter((n) => n.type === 'user_task')
    expect(tasks.map((t) => t.label)).toEqual(['Review', 'Approve'])
    expect(wf.edges.find((e) => e.source === 'stage_1' && e.label === 'Approve')!.target).toBe('stage_2_start')
    expect(wf.nodes.find((n) => n.id === 'stage_2_start')!.config.column_values).toEqual({ stage: 'Approve' })
    expect(buildTableColumns(s).map((c) => c.key)).toEqual(expect.arrayContaining(['stage', 'decided_by', 'decision_note']))
    expect(buildTableColumns(s).find((c) => c.key === 'status')!.options).toEqual([STATUS.pending, STATUS.approved, STATUS.declined, STATUS.changes])
    // Every node is reachable and no node waits on two branches (no joins).
    const incoming = new Map<string, number>()
    for (const e of wf.edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
    expect([...incoming.values()].every((n) => n === 1)).toBe(true)
  })

  it('AAD group: claim mode', () => {
    const s = spec({ approval: { mode: 'team', stages: [{ id: 's1', name: 'Group', assignee: { kind: 'group', group_id: 'g-1', group_name: 'Finance' } }] } })
    expect(buildWorkflow(s, REFS).nodes.find((n) => n.type === 'user_task')!.config).toMatchObject({ assignment_type: 'aad_group', aad_group_id: 'g-1', aad_group_mode: 'claim' })
    expect(reviewFields(s).every((f) => f.type === 'heading' || f.key === 'review_note' || f.read_only)).toBe(true)
  })
})

describe('quiz scoring, reports and the plan', () => {
  const quiz = () => spec({ questions: [
    { id: 'a', kind: 'choice', label: 'Colour', options: ['Red', 'Blue'], score: { correct: ['Blue'] } },
    { id: 'b', kind: 'yes_no', label: 'Star?', score: { correct: ['Yes'], points: 2 } },
    { id: 'c', kind: 'choices', label: 'Primes', options: ['2', '3', '4'], score: { correct: ['2', '3'] } },
  ] })

  it('the workflow computes the same score as the results page', () => {
    const s = quiz()
    const [a, b, c] = s.questions.map((q) => q.key!)
    const expr = scoreExpression(s)!
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ [a]: 'Blue', [b]: 'Yes', [c]: ['2', '3'] }, 4],
      [{ [a]: 'Red', [b]: 'Yes', [c]: ['3', '2'] }, 3],
      [{ [a]: 'Blue', [b]: 'No', [c]: ['2', '3', '4'] }, 1],
    ]
    for (const [values, score] of cases) {
      expect(scoreOf(s, values)).toBe(score)
      expect(Number(resolveExpression(expr, { variables: { form: values } } as any))).toBe(score)
    }
    expect(buildTableColumns(s).some((col) => col.key === 'score')).toBe(true)
  })

  it('reports: ONE report per form with every question as a column (+ status / decision with approval)', () => {
    const s = spec({ approval: { mode: 'single', stages: [{ id: 's1', name: 'A', assignee: { kind: 'person', user_id: U1 } }] } })
    const reports = buildReports(s, REFS.tableId)
    expect(reports.map((r) => r.key)).toEqual(['responses'])
    const cols = (reports[0].config as { columns: string[] }).columns
    for (const q of s.questions.filter((q) => !['heading', 'page_break', 'file'].includes(q.kind))) expect(cols, q.label).toContain(`data_${q.key}`)
    expect(cols).toEqual(expect.arrayContaining(['data_status', 'data_decided_by', 'data_decision_note']))
    expect(reports[0].config).toMatchObject({ data_source: `custom_table_${REFS.tableId}`, visualization: 'table' })
    expect(wizardPlan(s).map((i) => i.kind)).toEqual(['form', 'table', 'workflow', 'results', 'reports', 'access'])
  })

  it('results: choice counts, rating average, NPS and the summary cards', () => {
    const s = spec({ questions: [
      { id: 'r', kind: 'rating', label: 'Rating' }, { id: 'n', kind: 'nps', label: 'Recommend' }, { id: 'm', kind: 'choices', label: 'Likes', options: ['Fast', 'Cheap'] },
    ], approval: { mode: 'single', stages: [{ id: 's1', name: 'A', assignee: { kind: 'person', user_id: U1 } }] } })
    const [r, n, m] = s.questions.map((q) => q.key!)
    const now = Date.parse('2026-11-06T00:00:00Z')
    const rows = [
      { created_at: '2026-11-05T00:00:00Z', values: { [r]: '5', [n]: '10', [m]: ['Fast', 'Cheap'], status: STATUS.approved } },
      { created_at: '2026-11-04T00:00:00Z', values: { [r]: '3', [n]: '6', [m]: ['Fast'], status: STATUS.declined } },
      { created_at: '2026-10-25T00:00:00Z', values: { [r]: '4', [n]: '9', [m]: [], status: STATUS.pending } },
    ]
    const charts = wizardCharts(s, rows.map((x) => x.values))
    expect(charts[0]).toMatchObject({ kind: 'rating', average: 4, answered: 3 })
    expect(charts[0].kind === 'rating' && charts[0].distribution.find((c) => c.name === '5')!.value).toBe(1)
    expect(charts[1]).toMatchObject({ kind: 'nps', score: 33 }) // 2 promoters, 1 detractor of 3
    expect(charts[2].kind === 'choice' && charts[2].distribution.map((c) => [c.name, c.value])).toEqual([['Fast', 2], ['Cheap', 1]])
    expect(wizardSummary(s, rows, now)).toMatchObject({ total: 3, this_week: 2, last_week: 1, pending: 1, approved: 1, declined: 1, approval_rate: 50 })
  })
})

describe('AI suggestions and the response policy', () => {
  it('keeps only usable suggested questions', () => {
    const qs = questionsFromAi('Sure! {"name":"Bike survey","questions":[{"kind":"choice","label":"Bike?","options":["Road","MTB","Road"]},{"kind":"bogus","label":"x"},{"kind":"choice","label":"No options"},{"kind":"rating","label":"Rate it","required":true}]}')
    expect(qs.map((q) => [q.kind, q.label, q.options ?? null, q.required ?? false])).toEqual([['choice', 'Bike?', ['Road', 'MTB'], false], ['rating', 'Rate it', null, true]])
    expect(questionsFromAi('no json here')).toEqual([])
  })

  it('opens, closes and one response per person', () => {
    const now = Date.parse('2026-11-06T12:00:00Z')
    const open = { opens_at: null, closes_at: null, multiple_responses: true }
    expect(responsePolicyProblem(open, { now, signedIn: true, alreadyResponded: true })).toBeNull()
    expect(responsePolicyProblem({ ...open, opens_at: '2026-11-07T00:00:00Z' }, { now, signedIn: true, alreadyResponded: false })).toMatch(/opens on/)
    expect(responsePolicyProblem({ ...open, closes_at: '2026-11-06T00:00:00Z' }, { now, signedIn: true, alreadyResponded: false })).toMatch(/closed/)
    expect(responsePolicyProblem({ ...open, multiple_responses: false }, { now, signedIn: true, alreadyResponded: true })).toMatch(/already responded/)
    expect(responsePolicyProblem({ ...open, multiple_responses: false }, { now, signedIn: false, alreadyResponded: true })).toBeNull()
  })
})
