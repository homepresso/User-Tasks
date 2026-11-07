/**
 * The form wizard's step components (components/forms/wizard): each step
 * renders from a spec in plain words, hides what the workspace can't offer
 * (public links when anonymous forms are off, AI drafting without a
 * provider), and the shell's per-step problems map schema paths to steps.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/forms/wizard/new', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/app/actions/form-wizard', () => ({}))

import { StepApproval, StepAudience, StepLook, StepQuestions, StepResults, StepReview, StepStart } from '@/components/forms/wizard/wizard-steps'
import { normalizeDraft, problemsByStep, recalledStep, rememberStep, wizardResumeUrl, WIZARD_STEPS } from '@/components/forms/wizard/form-wizard'
import { specFromTemplate, WIZARD_TEMPLATE_ORDER } from '@/lib/forms/wizard/templates'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { wizardPlan, assignWizardKeys } from '@/lib/forms/wizard/build'
import type { WizardOptions } from '@/lib/services/form-wizard'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

const OPTIONS: WizardOptions = {
  anonymous_enabled: false, ai_available: false, entra_groups: false,
  themes: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Brand' }],
  roles: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Member' }],
  teams: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Reviewers' }],
  people: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Ada', email: 'ada@example.com' }],
  designers: { form: false, workflow: false, table: false, reports: false },
}
const spec = () => normalizeDraft(specFromTemplate('survey').spec)
const html = (el: any) => renderToStaticMarkup(el)
const noop = () => {}

describe('wizard steps render', () => {
  it('step 1: template cards, name; AI drafting only with a provider', () => {
    const props = { spec: spec(), onChange: noop, options: OPTIONS, problems: [], onPickTemplate: noop, onDraftWithAi: async () => null, aiBusy: false }
    const out = html(createElement(StepStart, props))
    for (const t of ['request', 'survey', 'quiz', 'registration', 'feedback', 'incident', 'blank']) expect(out).toContain(`wizard-template-${t}`)
    expect(out).toContain('aria-checked="true"')
    expect(out).not.toContain('Describe it and we')
    expect(html(createElement(StepStart, { ...props, options: { ...OPTIONS, ai_available: true } }))).toContain('Describe it and we')
  })

  it('step 2: every question in plain words, problems listed', () => {
    const out = html(createElement(StepQuestions, { spec: spec(), onChange: noop, options: OPTIONS, problems: ['Question 2: needs at least one option'], quiz: false }))
    expect(out).toContain('Overall, how satisfied are you?')
    expect(out).toContain('Star rating')
    expect(out).toContain('Recommend score (0 to 10)')
    expect(out).toContain('Grid of statements')
    expect(out).toContain('Rank in order')
    expect(out).toContain('needs at least one option')
    expect((out.match(/data-testid="wizard-question"/g) ?? []).length).toBe(6)
  })

  it('steps 3-6: look, audience (public link hidden when off), approval, results', () => {
    expect(html(createElement(StepLook, { spec: spec(), onChange: noop, options: OPTIONS, problems: [] }))).toContain('One question at a time')
    const audience = html(createElement(StepAudience, { spec: spec(), onChange: noop, options: OPTIONS, problems: [] }))
    expect(audience).toContain('Public links are off for this workspace')
    expect(html(createElement(StepAudience, { spec: spec(), onChange: noop, options: { ...OPTIONS, anonymous_enabled: true }, problems: [] }))).toContain('Anyone with a public link')
    const s = spec()
    const approval = html(createElement(StepApproval, { spec: { ...s, approval: { ...s.approval, mode: 'multi', stages: [
      { id: 's1', name: 'Review', assignee: { kind: 'team', team_id: OPTIONS.teams[0].id }, outcomes: ['approve', 'changes'] },
      { id: 's2', name: 'Approve', assignee: { kind: 'person', user_id: OPTIONS.people[0].id }, outcomes: ['approve', 'decline'] },
    ] } }, onChange: noop, options: OPTIONS, problems: [], suggested: null }))
    expect(approval).toContain('Stage 1')
    expect(approval).toContain('Stage 2')
    expect(approval).toContain('Ask for changes')
    expect(approval).not.toContain('Entra ID group')
    expect(html(createElement(StepResults, { spec: spec(), onChange: noop, options: OPTIONS, problems: [] }))).toContain('Roles who can see the results')
  })

  it('step 7: the plan of what will be created', () => {
    const plan = wizardPlan(spec())
    const out = html(createElement(StepReview, { plan, problems: [], editing: false }))
    expect(out).toContain('Data table')
    expect(out).toContain('Results page')
    expect(html(createElement(StepReview, { plan, problems: [], editing: true }))).toContain('nothing already collected is removed')
  })
})

describe('wizard shell helpers', () => {
  it('maps problems to the step they belong to', () => {
    const s = spec()
    const broken = { ...s, name: '', questions: [{ id: 'a', kind: 'choice' as const, label: 'Pick', options: [] }] }
    const p = problemsByStep(broken as any)
    expect(p.start?.join()).toMatch(/Give it a name/)
    expect(p.questions?.join()).toMatch(/Question 1 \("Pick"\): .*needs at least one option/)
    expect(problemsByStep(s)).toEqual({})
    expect(WIZARD_STEPS.map((x) => x.id)).toEqual(['start', 'questions', 'look', 'audience', 'approval', 'results', 'review'])
  })

  it('a half-finished draft opens with defaults filled', () => {
    const d = normalizeDraft({ name: 'Mine' })
    expect(d.name).toBe('Mine')
    expect(d.audience.internal).toBe(true)
    expect(d.questions.length).toBeGreaterThan(0)
  })
})

describe('wizard regressions (first browser walkthrough)', () => {
  // The shell computes the plan on every render from the spec being edited, whose
  // questions have no keys yet: wizardPlan threw "Question … has no key
  // (assignWizardKeys first)" and the wizard crashed on open.
  it.each(WIZARD_TEMPLATE_ORDER)('the plan of a fresh %s spec (no keys yet) renders', (template) => {
    const fresh = normalizeDraft(specFromTemplate(template).spec)
    expect(fresh.questions.some((q) => !q.key)).toBe(true)
    const plan = wizardPlan(fresh)
    expect(plan.map((i) => i.kind)).toEqual(['form', 'table', 'workflow', 'results', 'reports', 'access'])
    expect(html(createElement(StepReview, { plan, problems: [], editing: false }))).toContain('wizard-plan')
    expect(wizardPlan(fresh)).toEqual(wizardPlan(assignWizardKeys(fresh)))
  })

  it('the plan copes with every question kind, unkeyed and half-finished', () => {
    const s = spec()
    const kinds = ['short_text', 'long_text', 'number', 'money', 'date', 'choice', 'choices', 'rating', 'nps', 'yes_no', 'email', 'phone', 'file', 'heading', 'page_break'] as const
    const questions = kinds.map((kind, i) => ({ id: `q${i}`, kind, label: i === 3 ? '' : `Q ${kind}`, ...(kind === 'choice' || kind === 'choices' ? { options: ['A', ''] } : {}) }))
    expect(() => wizardPlan({ ...s, questions } as any)).not.toThrow()
  })

  // Autosave records the new draft in the URL. history.replaceState goes through the
  // App Router; moving to /forms/wizard/<id> (another route) remounted the wizard
  // mid-edit: back to step 1 and a second draft on the next save.
  it('autosave keeps the URL on the /forms/wizard/new route', () => {
    expect(wizardResumeUrl('8a16dbf4-707f-4b84-9fef-6d34f170813d')).toBe('/forms/wizard/new?draft=8a16dbf4-707f-4b84-9fef-6d34f170813d')
    const source = readFileSync(join(process.cwd(), 'components/forms/wizard/form-wizard.tsx'), 'utf8')
    for (const m of source.matchAll(/history\.(?:replaceState|pushState)\(([^)]*)\)/g)) expect(m[1]).toMatch(/wizardResumeUrl\(/)
  })

  it('a refresh reopens a draft at the step it was on (this tab only)', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } })
    try {
      expect(recalledStep('d1')).toBe(0)
      rememberStep('d1', 3)
      expect(recalledStep('d1')).toBe(3)
      expect(WIZARD_STEPS[recalledStep('d1')].id).toBe('audience')
      expect(recalledStep('other')).toBe(0)
    } finally { vi.unstubAllGlobals() }
    expect(recalledStep('d1')).toBe(0) // no window / storage: step 1
  })
})
