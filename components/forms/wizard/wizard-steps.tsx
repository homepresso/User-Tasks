'use client'

/**
 * The form wizard's steps (components/forms/wizard/form-wizard.tsx owns the
 * state): plain-language editors over one WizardSpec. Every step is a pure
 * view of the spec plus an `onChange(next)`; nothing here talks to the server
 * except "Describe it and we'll draft it" (through `onDraftWithAi`).
 */

import { useState, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, Bug, ClipboardList, Copy, FilePlus2, GraduationCap, MessageSquareHeart, Plus, Sparkles, Trash2, UserPlus, Vote,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/ui/field'
import { Card } from '@/components/ui/card'
import { Checkbox, Radio } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  APPROVAL_MODES, APPROVAL_MODE_LABELS, CONDITION_OPS, CONDITION_OP_LABELS, LAYOUT_KINDS, OPTION_KINDS, QUESTION_KINDS, QUESTION_KIND_LABELS,
  SCORABLE_KINDS, STAGE_OUTCOMES, STAGE_OUTCOME_LABELS, VALUE_OPS, WIZARD_LAYOUTS, WIZARD_LAYOUT_LABELS, newWizardId,
  NO_CONDITION_KINDS, QUESTION_KIND_ORDER, conditionAllowsContains, conditionChoices,
  type ApprovalMode, type QuestionKind, type StageAssignee, type WizardQuestion, type WizardSpec, type WizardStage, type WizardTemplate,
} from '@/lib/forms/wizard/spec'
import { WIZARD_TEMPLATE_DEFS, WIZARD_TEMPLATE_ORDER } from '@/lib/forms/wizard/templates'
import type { WizardPlanItem } from '@/lib/forms/wizard/build'
import { QuestionSettings, surveyQuestionDefaults } from './question-settings'
import type { WizardOptions } from '@/lib/services/form-wizard'

export interface StepProps {
  spec: WizardSpec
  onChange: (next: WizardSpec) => void
  options: WizardOptions
  /** Problems of this step (shown after Next was pressed). */
  problems: string[]
}

const TEMPLATE_ICONS: Record<WizardTemplate, typeof ClipboardList> = {
  request: ClipboardList, survey: Vote, quiz: GraduationCap, registration: UserPlus, feedback: MessageSquareHeart, incident: Bug, blank: FilePlus2,
}

function Problems({ problems }: { problems: string[] }) {
  if (!problems.length) return null
  return (
    <div data-testid="wizard-problems">
      <InlineNotice tone="danger" title="Before you go on">
        <ul className="list-disc space-y-0.5 pl-4">{problems.slice(0, 6).map((p, i) => <li key={`${i}:${p}`}>{p}</li>)}</ul>
      </InlineNotice>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/* ── 1. What are you building? ──────────────────────────────────────── */

export function StepStart({ spec, onChange, options, problems, onPickTemplate, onDraftWithAi, aiBusy }: StepProps & {
  onPickTemplate: (template: WizardTemplate) => void
  onDraftWithAi: (description: string) => Promise<string | null>
  aiBusy: boolean
}) {
  const [describe, setDescribe] = useState('')
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  return (
    <div className="space-y-6" data-testid="wizard-step-start">
      <Section title="What are you building?" description="Pick the closest one: it fills in starter questions you can change on the next step.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Kind of form">
          {WIZARD_TEMPLATE_ORDER.map((id) => {
            const def = WIZARD_TEMPLATE_DEFS[id]
            const Icon = TEMPLATE_ICONS[id]
            const selected = spec.template === id
            return (
              <button
                key={id} type="button" role="radio" aria-checked={selected} onClick={() => onPickTemplate(id)} data-testid={`wizard-template-${id}`}
                className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary',
                  selected ? 'border-primary bg-primary-wash' : 'border-border bg-surface')}
              >
                <Icon className={cn('mt-0.5 size-5 shrink-0', selected ? 'text-primary-text' : 'text-fg-muted')} aria-hidden />
                <span>
                  <span className="block text-sm font-medium text-fg">{def.title}</span>
                  <span className="block text-xs text-fg-muted">{def.blurb}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" description="People see this at the top of the form.">
          <Input value={spec.name} maxLength={120} onChange={(e) => onChange({ ...spec, name: e.target.value })} data-testid="wizard-name" />
        </Field>
        <Field label="Short description" optional>
          <Input value={spec.description ?? ''} maxLength={300} onChange={(e) => onChange({ ...spec, description: e.target.value || undefined })} />
        </Field>
      </div>
      {options.ai_available && (
        <Card padding="md" className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-primary-text" aria-hidden /> Describe it and we&apos;ll draft it</div>
          <p className="text-xs text-fg-muted">Say what the form is for and who fills it in. Your text is sent to your workspace&apos;s AI provider to suggest questions; you can change them all.</p>
          <Textarea rows={3} value={describe} maxLength={2000} onChange={(e) => setDescribe(e.target.value)} placeholder="For example: a sign-up form for our volunteer day, asking for name, team, T-shirt size and dietary needs" aria-label="Describe the form" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" leadingIcon={<Sparkles />} loading={aiBusy} disabled={describe.trim().length < 10}
              onClick={async () => setAiMessage(await onDraftWithAi(describe))}>Draft questions</Button>
            {aiMessage && <span className="text-xs text-fg-muted" role="status">{aiMessage}</span>}
          </div>
        </Card>
      )}
      <Problems problems={problems} />
    </div>
  )
}

/* ── 2. Questions ───────────────────────────────────────────────────── */

const ADD_KINDS: QuestionKind[] = [...QUESTION_KIND_ORDER, ...QUESTION_KINDS.filter((k) => !QUESTION_KIND_ORDER.includes(k))]

function blankQuestion(kind: QuestionKind, taken: string[]): WizardQuestion {
  return {
    id: newWizardId('q', taken), kind,
    label: kind === 'heading' ? 'Section heading' : kind === 'page_break' ? 'Page break' : '',
    ...surveyQuestionDefaults(kind),
  }
}

export function StepQuestions({ spec, onChange, problems, quiz }: StepProps & { quiz: boolean }) {
  const [adding, setAdding] = useState<QuestionKind>('short_text')
  const [open, setOpen] = useState<string | null>(spec.questions[0]?.id ?? null)
  const setQuestions = (questions: WizardQuestion[]) => onChange({ ...spec, questions })
  const update = (id: string, patch: Partial<WizardQuestion>) => setQuestions(spec.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  const move = (index: number, by: number) => {
    const next = [...spec.questions]
    const [q] = next.splice(index, 1)
    next.splice(index + by, 0, q)
    // A condition can only look back: drop ones that now point forward.
    setQuestions(next.map((x, i) => (x.show_if && !next.slice(0, i).some((p) => p.id === x.show_if!.question) ? { ...x, show_if: null } : x)))
  }
  const remove = (id: string) => setQuestions(spec.questions.filter((q) => q.id !== id).map((q) => (q.show_if?.question === id ? { ...q, show_if: null } : q)))
  const duplicate = (index: number) => {
    const q = spec.questions[index]
    const copy = { ...q, id: newWizardId('q', spec.questions.map((x) => x.id)), key: undefined, label: `${q.label} (copy)`.slice(0, 300) }
    const next = [...spec.questions]
    next.splice(index + 1, 0, copy)
    setQuestions(next)
    setOpen(copy.id)
  }
  const add = () => {
    const q = blankQuestion(adding, spec.questions.map((x) => x.id))
    setQuestions([...spec.questions, q])
    setOpen(q.id)
  }
  return (
    <div className="space-y-4" data-testid="wizard-step-questions">
      <Section title="Questions" description="Add, reorder and change the questions. Open one to edit it.">
        <ol className="space-y-2">
          {spec.questions.map((q, i) => (
            <li key={q.id}>
              <QuestionCard
                spec={spec} question={q} index={i} quiz={quiz} open={open === q.id}
                onToggle={() => setOpen(open === q.id ? null : q.id)}
                onChange={(patch) => update(q.id, patch)}
                onMoveUp={i > 0 ? () => move(i, -1) : undefined}
                onMoveDown={i < spec.questions.length - 1 ? () => move(i, 1) : undefined}
                onDuplicate={() => duplicate(i)}
                onRemove={spec.questions.length > 1 ? () => remove(q.id) : undefined}
              />
            </li>
          ))}
        </ol>
      </Section>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add a question" className="min-w-52">
          <Select value={adding} onChange={(e) => setAdding(e.target.value as QuestionKind)} options={ADD_KINDS.map((k) => ({ value: k, label: QUESTION_KIND_LABELS[k] }))} data-testid="wizard-add-kind" />
        </Field>
        <Button variant="secondary" leadingIcon={<Plus />} onClick={add} disabled={spec.questions.length >= 100} data-testid="wizard-add-question">Add</Button>
      </div>
      <Problems problems={problems} />
    </div>
  )
}

function QuestionCard({ spec, question: q, index, quiz, open, onToggle, onChange, onMoveUp, onMoveDown, onDuplicate, onRemove }: {
  spec: WizardSpec; question: WizardQuestion; index: number; quiz: boolean; open: boolean
  onToggle: () => void; onChange: (patch: Partial<WizardQuestion>) => void
  onMoveUp?: () => void; onMoveDown?: () => void; onDuplicate: () => void; onRemove?: () => void
}) {
  const earlier = spec.questions.slice(0, index).filter((p) => !LAYOUT_KINDS.has(p.kind) && !NO_CONDITION_KINDS.has(p.kind))
  const layout = LAYOUT_KINDS.has(q.kind)
  return (
    <Card padding="none" className={cn('overflow-hidden', open && 'ring-1 ring-primary')} data-testid="wizard-question">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onToggle} aria-expanded={open}>
          <span className="block truncate text-sm font-medium text-fg">{index + 1}. {q.label || <span className="text-fg-subtle">Untitled question</span>}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
            {QUESTION_KIND_LABELS[q.kind]}
            {q.required && <Badge tone="neutral">Required</Badge>}
            {q.show_if && <Badge tone="info">Conditional</Badge>}
            {q.score && <Badge tone="brand">Scored</Badge>}
          </span>
        </button>
        <div className="flex shrink-0 items-center">
          <Button size="icon" variant="ghost" aria-label="Move up" disabled={!onMoveUp} onClick={onMoveUp}><ArrowUp /></Button>
          <Button size="icon" variant="ghost" aria-label="Move down" disabled={!onMoveDown} onClick={onMoveDown}><ArrowDown /></Button>
          <Button size="icon" variant="ghost" aria-label="Duplicate" onClick={onDuplicate}><Copy /></Button>
          <Button size="icon" variant="ghost" aria-label="Delete" disabled={!onRemove} onClick={onRemove}><Trash2 /></Button>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border bg-subtle/40 px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <Field label={q.kind === 'heading' ? 'Heading text' : 'Question'}>
              <Input value={q.label} maxLength={300} onChange={(e) => onChange({ label: e.target.value })} autoFocus data-testid="wizard-question-label" />
            </Field>
            <Field label="Kind">
              <Select value={q.kind} onChange={(e) => {
                const kind = e.target.value as QuestionKind
                onChange({ kind, settings: undefined, ...surveyQuestionDefaults(kind, q), ...(SCORABLE_KINDS.has(kind) ? {} : { score: null }) })
              }} options={ADD_KINDS.map((k) => ({ value: k, label: QUESTION_KIND_LABELS[k] }))} />
            </Field>
          </div>
          {!layout && (
            <>
              <Field label="Help text" optional description="A hint shown under the question.">
                <Input value={q.help ?? ''} maxLength={500} onChange={(e) => onChange({ help: e.target.value || undefined })} />
              </Field>
              <Switch checked={Boolean(q.required)} onCheckedChange={(v) => onChange({ required: v })} label="Required" />
            </>
          )}
          {q.kind === 'money' && (
            <Field label="Currency" className="max-w-40">
              <Input value={q.currency ?? 'USD'} maxLength={3} onChange={(e) => { const c = e.target.value.toUpperCase(); onChange({ currency: /^[A-Z]{3}$/.test(c) ? c : undefined }) }} />
            </Field>
          )}
          <QuestionSettings question={q} onChange={onChange} />
          {OPTION_KINDS.has(q.kind) && <OptionsEditor options={q.options ?? []} onChange={(options) => onChange({ options })} />}
          {quiz && SCORABLE_KINDS.has(q.kind) && <ScoreEditor question={q} onChange={onChange} />}
          {q.kind !== 'page_break' && earlier.length > 0 && <ConditionEditor question={q} earlier={earlier} onChange={onChange} />}
        </div>
      )}
    </Card>
  )
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-fg">Options</legend>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input value={o} maxLength={120} aria-label={`Option ${i + 1}`} onChange={(e) => onChange(options.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button size="icon" variant="ghost" aria-label={`Remove option ${i + 1}`} disabled={options.length <= 1} onClick={() => onChange(options.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" leadingIcon={<Plus />} disabled={options.length >= 50} onClick={() => onChange([...options, `Option ${options.length + 1}`])}>Add option</Button>
    </fieldset>
  )
}

function ScoreEditor({ question: q, onChange }: { question: WizardQuestion; onChange: (patch: Partial<WizardQuestion>) => void }) {
  const choices = q.kind === 'yes_no' ? ['Yes', 'No'] : q.options ?? []
  const correct = q.score?.correct ?? []
  const toggle = (c: string) => {
    const next = q.kind === 'choices' ? (correct.includes(c) ? correct.filter((x) => x !== c) : [...correct, c]) : [c]
    onChange({ score: next.length ? { correct: next, points: q.score?.points } : null })
  }
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-fg">Right answer{q.kind === 'choices' ? 's' : ''} (for the score)</legend>
      <div className="flex flex-wrap gap-3">
        {choices.map((c) => q.kind === 'choices'
          ? <Checkbox key={c} label={c} checked={correct.includes(c)} onChange={() => toggle(c)} />
          : <Radio key={c} name={`score-${q.id}`} label={c} checked={correct.includes(c)} onChange={() => toggle(c)} />)}
      </div>
      {q.score && <Button size="sm" variant="ghost" onClick={() => onChange({ score: null })}>Don&apos;t score this question</Button>}
    </fieldset>
  )
}

function ConditionEditor({ question: q, earlier, onChange }: { question: WizardQuestion; earlier: WizardQuestion[]; onChange: (patch: Partial<WizardQuestion>) => void }) {
  const c = q.show_if
  if (!c) {
    return <Button size="sm" variant="ghost" onClick={() => onChange({ show_if: { question: earlier[earlier.length - 1].id, op: 'is', value: '' } })}>Show this question only if…</Button>
  }
  const source = earlier.find((p) => p.id === c.question) ?? earlier[0]
  const choices = conditionChoices(source)
  return (
    <fieldset className="space-y-1.5 rounded-md border border-border bg-surface p-2">
      <legend className="px-1 text-xs font-medium text-fg">Show this question only if</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select aria-label="Question" value={source.id} onChange={(e) => onChange({ show_if: { ...c, question: e.target.value, value: '' } })} options={earlier.map((p) => ({ value: p.id, label: p.label || 'Untitled question' }))} />
        <Select aria-label="Condition" value={c.op} onChange={(e) => onChange({ show_if: { ...c, op: e.target.value as typeof c.op } })}
          options={CONDITION_OPS.filter((op) => op !== 'contains' || conditionAllowsContains(source)).map((op) => ({ value: op, label: CONDITION_OP_LABELS[op] }))} />
        {VALUE_OPS.has(c.op) && (choices
          ? <Select aria-label="Answer" value={c.value ?? ''} placeholder="Choose an answer" onChange={(e) => onChange({ show_if: { ...c, value: e.target.value } })} options={choices.map((o) => ({ value: o, label: o }))} />
          : <Input aria-label="Answer" value={c.value ?? ''} maxLength={120} onChange={(e) => onChange({ show_if: { ...c, value: e.target.value } })} />)}
      </div>
      <Button size="sm" variant="ghost" onClick={() => onChange({ show_if: null })}>Always show it</Button>
    </fieldset>
  )
}

/* ── 3. Look & feel ─────────────────────────────────────────────────── */

const ACCENTS = ['#2563eb', '#0f766e', '#7c3aed', '#c2410c', '#be123c', '#334155']

export function StepLook({ spec, onChange, options, problems }: StepProps) {
  const look = spec.look
  const set = (patch: Partial<WizardSpec['look']>) => onChange({ ...spec, look: { ...look, ...patch } })
  const hasBreaks = spec.questions.some((q) => q.kind === 'page_break')
  return (
    <div className="space-y-6" data-testid="wizard-step-look">
      <Section title="Colours" description="Use your workspace's look, a saved form theme, or pick a colour.">
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Colours">
          <Button size="sm" variant={look.theme.kind === 'workspace' ? 'primary' : 'secondary'} onClick={() => set({ theme: { kind: 'workspace' } })} aria-pressed={look.theme.kind === 'workspace'}>Workspace look</Button>
          {ACCENTS.map((color) => (
            <button key={color} type="button" aria-label={`Colour ${color}`} aria-pressed={look.theme.kind === 'accent' && look.theme.color === color}
              onClick={() => set({ theme: { kind: 'accent', color } })}
              className={cn('size-8 rounded-full border-2', look.theme.kind === 'accent' && look.theme.color === color ? 'border-fg' : 'border-transparent')}
              style={{ backgroundColor: color }} />
          ))}
        </div>
        {options.themes.length > 0 && (
          <Field label="Or a saved form theme" className="max-w-sm">
            <Select value={look.theme.kind === 'saved' ? look.theme.theme_id : ''} placeholder="Choose a theme"
              onChange={(e) => set({ theme: e.target.value ? { kind: 'saved', theme_id: e.target.value } : { kind: 'workspace' } })}
              options={options.themes.map((t) => ({ value: t.id, label: t.name }))} />
          </Field>
        )}
      </Section>
      <Section title="Header">
        <Switch checked={look.header.show} onCheckedChange={(show) => set({ header: { ...look.header, show } })} label="Show a header at the top" />
        {look.header.show && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" optional description="Defaults to the form's name.">
              <Input value={look.header.title ?? ''} maxLength={120} onChange={(e) => set({ header: { ...look.header, title: e.target.value || undefined } })} />
            </Field>
            <Field label="Subtitle" optional>
              <Input value={look.header.subtitle ?? ''} maxLength={300} onChange={(e) => set({ header: { ...look.header, subtitle: e.target.value || undefined } })} />
            </Field>
            <Switch checked={look.header.logo} onCheckedChange={(logo) => set({ header: { ...look.header, logo } })} label="Show the workspace logo" />
          </div>
        )}
      </Section>
      <Section title="Layout">
        <div className="space-y-1.5" role="radiogroup" aria-label="Layout">
          {WIZARD_LAYOUTS.map((l) => (
            <Radio key={l} name="wizard-layout" checked={look.layout === l} onChange={() => set({ layout: l })} label={WIZARD_LAYOUT_LABELS[l]}
              description={l === 'steps' && !hasBreaks ? 'Add page breaks on the Questions step to split it.' : undefined} />
          ))}
        </div>
      </Section>
      <Section title="After someone submits">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Thank-you heading" optional>
            <Input value={look.success.heading ?? ''} maxLength={160} onChange={(e) => set({ success: { ...look.success, heading: e.target.value || undefined } })} placeholder="Thank you — your response was submitted" />
          </Field>
          <Field label="Message" optional description="Without one, people see their reference number.">
            <Input value={look.success.message ?? ''} maxLength={500} onChange={(e) => set({ success: { ...look.success, message: e.target.value || undefined } })} />
          </Field>
        </div>
      </Section>
      <Problems problems={problems} />
    </div>
  )
}

/* ── 4. Who fills it in ─────────────────────────────────────────────── */

function PickMany({ label, items, values, onChange }: { label: string; items: Array<{ id: string; name: string }>; values: string[]; onChange: (values: string[]) => void }) {
  if (!items.length) return null
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-fg">{label}</legend>
      <div className="flex max-h-44 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
        {items.map((item) => (
          <Checkbox key={item.id} label={item.name} checked={values.includes(item.id)} onChange={() => onChange(values.includes(item.id) ? values.filter((v) => v !== item.id) : [...values, item.id])} />
        ))}
      </div>
    </fieldset>
  )
}

const toLocal = (iso?: string | null) => (iso ? new Date(Date.parse(iso) - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : null)

export function StepAudience({ spec, onChange, options, problems }: StepProps) {
  const a = spec.audience
  const set = (patch: Partial<WizardSpec['audience']>) => onChange({ ...spec, audience: { ...a, ...patch } })
  return (
    <div className="space-y-6" data-testid="wizard-step-audience">
      <Section title="Who fills it in?">
        <Switch checked={a.internal} onCheckedChange={(internal) => set({ internal })} label="People in this workspace (signed in)" />
        {a.internal && (
          <div className="space-y-3 pl-1">
            <div className="space-y-1.5" role="radiogroup" aria-label="Which people">
              <Radio name="wizard-who" checked={a.who === 'everyone'} onChange={() => set({ who: 'everyone' })} label="Everyone in the workspace" />
              <Radio name="wizard-who" checked={a.who === 'selected'} onChange={() => set({ who: 'selected' })} label="Only some roles or teams" />
            </div>
            {a.who === 'selected' && (
              <div className="space-y-3">
                <PickMany label="Roles" items={options.roles} values={a.role_ids} onChange={(role_ids) => set({ role_ids })} />
                <PickMany label="Teams" items={options.teams} values={a.team_ids} onChange={(team_ids) => set({ team_ids })} />
              </div>
            )}
            <Switch checked={a.show_in_menu} onCheckedChange={(show_in_menu) => set({ show_in_menu })} label="List it in their Forms menu" />
          </div>
        )}
        {options.anonymous_enabled ? (
          <Switch checked={a.public_link} onCheckedChange={(public_link) => set({ public_link })} label="Anyone with a public link (no sign-in) — you can also embed it on a website" />
        ) : (
          <p className="text-xs text-fg-muted">Public links are off for this workspace. An admin can allow anonymous forms in Settings → Forms.</p>
        )}
      </Section>
      <Section title="Responses">
        <div className="space-y-1.5" role="radiogroup" aria-label="How many responses">
          <Radio name="wizard-multi" checked={a.multiple_responses} onChange={() => set({ multiple_responses: true })} label="People can respond more than once" />
          <Radio name="wizard-multi" checked={!a.multiple_responses} onChange={() => set({ multiple_responses: false })} label="One response per person" description={a.public_link ? 'Applies to people who are signed in; a public link cannot tell visitors apart.' : undefined} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Opens" optional description="Before this, the form says when it opens.">
            <Input type="datetime-local" value={toLocal(a.opens_at)} onChange={(e) => set({ opens_at: fromLocal(e.target.value) })} />
          </Field>
          <Field label="Closes" optional description="After this, it no longer accepts responses.">
            <Input type="datetime-local" value={toLocal(a.closes_at)} onChange={(e) => set({ closes_at: fromLocal(e.target.value) })} />
          </Field>
        </div>
      </Section>
      <Problems problems={problems} />
    </div>
  )
}

/* ── 5. Review & approval ───────────────────────────────────────────── */

function stageFor(mode: ApprovalMode, n: number, options: WizardOptions, taken: string[]): WizardStage {
  const person = options.people[0]?.id
  const team = options.teams[0]?.id
  const assignee: StageAssignee = mode === 'team' && team ? { kind: 'team', team_id: team }
    : mode === 'manager' ? { kind: 'manager', fallback_user_id: person ?? '' }
      : { kind: 'person', user_id: person ?? '' }
  return { id: newWizardId('s', taken), name: mode === 'multi' ? (n === 0 ? 'Review' : 'Approve') : mode === 'manager' ? 'Manager approval' : 'Approval', assignee, outcomes: ['approve', 'decline'] }
}

export function StepApproval({ spec, onChange, options, problems, suggested }: StepProps & { suggested: ApprovalMode | null }) {
  const ap = spec.approval
  const set = (patch: Partial<WizardSpec['approval']>) => onChange({ ...spec, approval: { ...ap, ...patch } })
  const pickMode = (mode: ApprovalMode) => {
    const ids: string[] = []
    const stages = mode === 'none' ? [] : mode === 'multi'
      ? [stageFor(mode, 0, options, ids), stageFor(mode, 1, options, ids)]
      : [stageFor(mode, 0, options, ids)]
    set({ mode, stages })
  }
  const setStage = (i: number, patch: Partial<WizardStage>) => set({ stages: ap.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  return (
    <div className="space-y-6" data-testid="wizard-step-approval">
      <Section title="Does someone need to review or approve it?" description="Optional. Each response can go to people who approve, decline or ask for changes; the decision is saved with the response.">
        <div className="space-y-1.5" role="radiogroup" aria-label="Review">
          {APPROVAL_MODES.filter((m) => m !== 'team' || options.teams.length || options.entra_groups).map((m) => (
            <Radio key={m} name="wizard-approval" checked={ap.mode === m} onChange={() => pickMode(m)} label={APPROVAL_MODE_LABELS[m]}
              description={suggested === m && ap.mode === 'none' ? 'Suggested for this kind of form' : undefined} data-testid={`wizard-approval-${m}`} />
          ))}
        </div>
      </Section>
      {ap.mode !== 'none' && (
        <>
          <ol className="space-y-3">
            {ap.stages.map((stage, i) => (
              <li key={stage.id}>
                <Card padding="md" className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-fg-muted">{ap.stages.length > 1 ? `Stage ${i + 1}` : 'Who approves'}</span>
                    {ap.mode === 'multi' && ap.stages.length > 2 && <Button size="sm" variant="ghost" leadingIcon={<Trash2 />} onClick={() => set({ stages: ap.stages.filter((_, j) => j !== i) })}>Remove</Button>}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Stage name"><Input value={stage.name} maxLength={60} onChange={(e) => setStage(i, { name: e.target.value })} /></Field>
                    <AssigneePicker mode={ap.mode} assignee={stage.assignee} options={options} onChange={(assignee) => setStage(i, { assignee })} />
                  </div>
                  <fieldset>
                    <legend className="text-xs font-medium text-fg">Buttons</legend>
                    <div className="mt-1 flex flex-wrap gap-4">
                      {STAGE_OUTCOMES.map((o) => (
                        <Checkbox key={o} label={STAGE_OUTCOME_LABELS[o]} checked={stage.outcomes.includes(o)} disabled={o === 'approve'}
                          onChange={() => setStage(i, { outcomes: stage.outcomes.includes(o) ? stage.outcomes.filter((x) => x !== o) : STAGE_OUTCOMES.filter((x) => x === o || stage.outcomes.includes(x)) })} />
                      ))}
                    </div>
                  </fieldset>
                </Card>
              </li>
            ))}
          </ol>
          {ap.mode === 'multi' && ap.stages.length < 5 && (
            <Button variant="secondary" leadingIcon={<Plus />} onClick={() => set({ stages: [...ap.stages, stageFor('multi', ap.stages.length, options, ap.stages.map((s) => s.id))] })}>Add a stage</Button>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Each stage is due after (days)" className="max-w-56">
              <Input type="number" min={1} max={90} value={ap.due_days} onChange={(e) => set({ due_days: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })} />
            </Field>
            <Switch checked={ap.notify_requester} onCheckedChange={(notify_requester) => set({ notify_requester })} label="Email the person who submitted it with the decision" />
          </div>
        </>
      )}
      <Problems problems={problems} />
    </div>
  )
}

function AssigneePicker({ mode, assignee, options, onChange }: { mode: ApprovalMode; assignee: StageAssignee; options: WizardOptions; onChange: (a: StageAssignee) => void }) {
  const kinds: Array<StageAssignee['kind']> = mode === 'single' ? ['person'] : mode === 'manager' ? ['manager'] : mode === 'team' ? ['team', ...(options.entra_groups ? ['group' as const] : [])] : ['person', 'manager', 'team', ...(options.entra_groups ? ['group' as const] : [])]
  const KIND_LABEL: Record<StageAssignee['kind'], string> = { person: 'A person', manager: "The person's manager", team: 'A team', group: 'An Entra ID group' }
  const people = options.people.map((p) => ({ value: p.id, label: p.email ? `${p.name} (${p.email})` : p.name }))
  return (
    <div className="space-y-2">
      {kinds.length > 1 && (
        <Field label="Who">
          <Select value={assignee.kind} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={(e) => {
            const k = e.target.value as StageAssignee['kind']
            onChange(k === 'person' ? { kind: 'person', user_id: options.people[0]?.id ?? '' } : k === 'manager' ? { kind: 'manager', fallback_user_id: options.people[0]?.id ?? '' }
              : k === 'team' ? { kind: 'team', team_id: options.teams[0]?.id ?? '' } : { kind: 'group', group_id: '' })
          }} />
        </Field>
      )}
      {assignee.kind === 'person' && <Field label="Person"><Select value={assignee.user_id} placeholder="Choose a person" options={people} onChange={(e) => onChange({ kind: 'person', user_id: e.target.value })} /></Field>}
      {assignee.kind === 'manager' && (
        <Field label="If they have no manager, send it to" description="Managers come from the reporting lines in Org.">
          <Select value={assignee.fallback_user_id} placeholder="Choose a person" options={people} onChange={(e) => onChange({ kind: 'manager', fallback_user_id: e.target.value })} />
        </Field>
      )}
      {assignee.kind === 'team' && (
        <Field label="Team" description="Anyone in the team can pick it up.">
          <Select value={assignee.team_id} placeholder="Choose a team" options={options.teams.map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => onChange({ kind: 'team', team_id: e.target.value })} />
        </Field>
      )}
      {assignee.kind === 'group' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Group id"><Input value={assignee.group_id} onChange={(e) => onChange({ ...assignee, group_id: e.target.value })} /></Field>
          <Field label="Group name" optional><Input value={assignee.group_name ?? ''} onChange={(e) => onChange({ ...assignee, group_name: e.target.value || undefined })} /></Field>
        </div>
      )}
    </div>
  )
}

/* ── 6. Results page ────────────────────────────────────────────────── */

export function StepResults({ spec, onChange, options, problems }: StepProps) {
  const r = spec.results
  const set = (patch: Partial<WizardSpec['results']>) => onChange({ ...spec, results: { ...r, ...patch } })
  return (
    <div className="space-y-6" data-testid="wizard-step-results">
      <Section title="Results page" description="A page with every response (search, filter, sort), summary cards and, if you like, charts. You always have access; choose who else may see it.">
        <Switch checked={r.charts} onCheckedChange={(charts) => set({ charts })} label="Charts for choices, ratings and recommend scores" />
        <PickMany label="Roles who can see the results" items={options.roles} values={r.role_ids} onChange={(role_ids) => set({ role_ids })} />
        <PickMany label="Teams who can see the results" items={options.teams} values={r.team_ids} onChange={(team_ids) => set({ team_ids })} />
      </Section>
      <Problems problems={problems} />
    </div>
  )
}

/* ── 7. Review & create ─────────────────────────────────────────────── */

export function StepReview({ plan, problems, editing }: { plan: WizardPlanItem[] | null; problems: string[]; editing: boolean }) {
  return (
    <div className="space-y-4" data-testid="wizard-step-review">
      <Section title={editing ? 'Review and save' : 'Review and create'} description={editing ? 'Saving updates everything below. New questions add columns; nothing already collected is removed.' : 'This is what will be made. Everything can be opened and changed afterwards.'}>
        {plan ? (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface" data-testid="wizard-plan">
            {plan.map((item) => (
              <li key={item.kind} className="px-3 py-2.5">
                <div className="text-sm font-medium text-fg">{item.title}</div>
                <div className="text-xs text-fg-muted">{item.detail}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-fg-muted">Checking…</p>}
      </Section>
      <Problems problems={problems} />
    </div>
  )
}
