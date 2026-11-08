/**
 * The form wizard's builders: a valid WizardSpec (./spec.ts) → the objects
 * the service creates, all of them ordinary objects the full designers open:
 *
 *   form       fields (one per question), layout (single page / steps / one
 *              question per step), "show only if" as Always show rules
 *              (lib/forms/form-rules.ts), header, theme, the Submitted page
 *   table      a column per question + the system columns (reference,
 *              submitted by / at, status, decision, score)
 *   workflow   "Form submitted" → save the response as a row → (review /
 *              approval stages: a User Task per stage with the response read
 *              only, branches per outcome, status written back, the
 *              requester emailed) → end
 *   report     one saved report on the table: every response, all questions,
 *              with summary charts above the table (buildResponseCharts)
 *
 * Question keys are the field keys AND the column keys, kept for good once
 * assigned (assignWizardKeys), so a later "Edit with the wizard" adds columns
 * and never moves or drops data. Pure and isomorphic.
 */

import { defaultFormAnimation, defaultSubmittedPage } from '../success-defaults'
import { uniqueFieldKey, type TaskFieldDef } from '@/lib/task-field-schema'
import type { FormRule } from '@/lib/forms/form-rules'
import type { FormLayout, FormPage, FormRow } from '@/lib/forms/layout'
import type { ReportConfig } from '@/lib/report-sources'
import { MAX_REPORT_CHARTS, type ReportChartSpec } from '@/lib/report-charts'
import { normalizeMatrixRows, surveyColumns, YES_NO_MAYBE } from '@/lib/forms/survey/controls'
import {
  APPROVAL_MODE_LABELS, LAYOUT_KINDS, QUESTION_KIND_LABELS, STAGE_OUTCOME_LABELS, conditionChoices,
  type ConditionOp, type StageOutcome, type WizardQuestion, type WizardSpec, type WizardStage,
} from './spec'

/* ── Keys ────────────────────────────────────────────────────────────── */

/** Columns the wizard adds to every responses table (question keys never use them). */
export const SYSTEM_COLUMNS = [
  { key: 'reference', name: 'Reference', type: 'text' },
  { key: 'submitted_by', name: 'Submitted by', type: 'text' },
  { key: 'submitted_by_email', name: 'Submitter email', type: 'text' },
  { key: 'submitted_at', name: 'Submitted at', type: 'date' },
  { key: 'status', name: 'Status', type: 'select' },
  { key: 'stage', name: 'Stage', type: 'text' },
  { key: 'decided_by', name: 'Decided by', type: 'text' },
  { key: 'decided_at', name: 'Decided at', type: 'date' },
  { key: 'decision_note', name: 'Decision note', type: 'longtext' },
  { key: 'score', name: 'Score', type: 'number' },
  { key: 'submission_id', name: 'Submission id', type: 'text' },
] as const
export type SystemColumnKey = (typeof SYSTEM_COLUMNS)[number]['key']

/** Keys a question may never take: system columns, data table system keys, our task fields. */
export const WIZARD_RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...SYSTEM_COLUMNS.map((c) => c.key), 'id', 'date_created', 'review_note', 'row_id', 'created_at', 'updated_at', 'created_by',
])

export const STATUS = {
  submitted: 'Submitted',
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  changes: 'Changes requested',
} as const
export const STATUS_VALUES: string[] = Object.values(STATUS)

/**
 * Every answer question gets a key (field = column), kept when it has one.
 * `taken` = keys already used by the form / table (an update never reuses a
 * removed question's key for a different question).
 */
export function assignWizardKeys(spec: WizardSpec, taken: Iterable<string> = []): WizardSpec {
  const used = new Set<string>([...WIZARD_RESERVED_KEYS, ...taken])
  // A grid of statements also takes a column per statement (<key>_<statement key>).
  const rowKeys = (q: WizardQuestion, key: string) => (q.kind === 'matrix' ? normalizeMatrixRows(q.rows ?? []).map((r) => `${key}_${r.key}`) : [])
  for (const q of spec.questions) if (q.key) { used.add(q.key); for (const k of rowKeys(q, q.key)) used.add(k) }
  return {
    ...spec,
    questions: spec.questions.map((q) => {
      if (q.key) return q
      let key = uniqueFieldKey(q.kind === 'heading' ? `heading_${q.label}` : q.kind === 'page_break' ? `page_${q.id}` : q.label, used)
      for (let i = 2; rowKeys(q, key).some((k) => used.has(k)); i++) key = uniqueFieldKey(`${q.label}_${i}`, used)
      used.add(key)
      for (const k of rowKeys(q, key)) used.add(k)
      return { ...q, key }
    }),
  }
}

function keyOf(q: WizardQuestion): string {
  if (!q.key) throw new Error(`Question "${q.label}" has no key (assignWizardKeys first)`)
  return q.key
}

export function answerQuestions(spec: WizardSpec): WizardQuestion[] {
  return spec.questions.filter((q) => !LAYOUT_KINDS.has(q.kind))
}

export function isQuiz(spec: WizardSpec): boolean {
  return spec.questions.some((q) => q.score)
}

/* ── Form ────────────────────────────────────────────────────────────── */

export const YES_NO = ['Yes', 'No']

/** End labels of a scale question, when set. */
function scaleLabels(q: WizardQuestion): { low_label?: string; high_label?: string } {
  return { ...(q.settings?.low_label ? { low_label: q.settings.low_label } : {}), ...(q.settings?.high_label ? { high_label: q.settings.high_label } : {}) }
}

/** One question → one form field (page breaks are layout, not fields). */
export function questionField(q: WizardQuestion): TaskFieldDef | null {
  if (q.kind === 'page_break') return null
  const key = keyOf(q)
  const base = { key, label: q.label, ...(q.help ? { help_text: q.help } : {}) }
  const required = q.required ? { required: true } : {}
  switch (q.kind) {
    case 'heading': return { ...base, type: 'heading' }
    case 'short_text': return { ...base, ...required, type: 'text', max_length: 500 }
    case 'long_text': return { ...base, ...required, type: 'textarea', max_length: 5000 }
    case 'number': return { ...base, ...required, type: 'number' }
    case 'money': return { ...base, ...required, type: 'currency', currency: q.currency ?? 'USD', min: 0 }
    case 'date': return { ...base, ...required, type: 'date' }
    case 'choice': return { ...base, ...required, type: 'choice', options: [...(q.options ?? [])], display: (q.options?.length ?? 0) > 6 ? 'dropdown' : 'radio' }
    case 'choices': return { ...base, ...required, type: 'multi_choice', options: [...(q.options ?? [])] }
    // Survey controls (lib/forms/survey/controls.ts).
    case 'rating': return { ...base, ...required, type: 'rating', max: Math.round(q.settings?.max ?? 5), survey: { icon: q.settings?.icon ?? 'star', ...(q.settings?.half ? { half: true } : {}), ...scaleLabels(q) } }
    case 'nps': return { ...base, ...required, type: 'nps', survey: { low_label: q.settings?.low_label ?? 'Not at all likely', high_label: q.settings?.high_label ?? 'Extremely likely', ...(q.settings?.bands ? { bands: true } : {}) } }
    case 'likert': return { ...base, ...required, type: 'likert', options: [...(q.options ?? [])] }
    case 'matrix': return { ...base, ...required, type: 'matrix', options: [...(q.options ?? [])], survey: { rows: normalizeMatrixRows(q.rows ?? []) } }
    case 'slider': return { ...base, ...required, type: 'slider', min: q.settings?.min ?? 0, max: q.settings?.max ?? 100, survey: { step: q.settings?.step ?? 1, ...(q.settings?.unit ? { unit: q.settings.unit } : {}), ...scaleLabels(q) } }
    case 'csat': return { ...base, ...required, type: 'csat', ...(q.settings?.faces === 3 ? { survey: { faces: 3 } } : {}) }
    case 'ranking': return { ...base, ...required, type: 'ranking', options: [...(q.options ?? [])] }
    case 'image_choice': {
      const images = Object.fromEntries((q.options ?? []).flatMap((o) => (q.settings?.icons?.[o] ? [[o, `icon:${q.settings.icons[o]}`]] : [])))
      return { ...base, ...required, type: 'image_choice', options: [...(q.options ?? [])], survey: { ...(q.settings?.multiple ? { multiple: true } : {}), ...(Object.keys(images).length ? { images } : {}) } }
    }
    case 'yes_no_maybe': return { ...base, ...required, type: 'yes_no_maybe', options: [...YES_NO_MAYBE] }
    case 'yes_no': return { ...base, ...required, type: 'choice', options: YES_NO, display: 'radio' }
    case 'email': return { ...base, ...required, type: 'email' }
    case 'phone': return { ...base, ...required, type: 'phone' }
    case 'file': return { ...base, ...required, type: 'attachments', attachments: { max_files: 5, max_file_mb: 10, types: ['documents', 'images'] } } as TaskFieldDef
  }
}

export function buildFormFields(spec: WizardSpec): TaskFieldDef[] {
  return spec.questions.map(questionField).filter((f): f is TaskFieldDef => f !== null)
}

const OPERATOR: Record<ConditionOp, string> = { is: 'eq', is_not: 'neq', contains: 'contains', answered: 'is_set', not_answered: 'is_not_set', gt: 'gt', lt: 'lt' }

/** A question's "show only if" as an Always show rule on the field (and its own step, when it has one). */
export function conditionRule(spec: WizardSpec, q: WizardQuestion, pageId?: string | null): FormRule | null {
  if (!q.show_if || q.kind === 'page_break') return null
  const source = spec.questions.find((p) => p.id === q.show_if!.question)
  if (!source?.key) return null
  const op = q.show_if.op
  const condition: Record<string, string> = { column: source.key, operator: OPERATOR[op] }
  if (op !== 'answered' && op !== 'not_answered') condition.value = String(q.show_if.value ?? '')
  return {
    id: `show_${keyOf(q)}`.slice(0, 40),
    name: `Show "${q.label}"`.slice(0, 80),
    event: 'always',
    if: { match: 'all', conditions: [condition as never] },
    then: [{ type: 'show_hide', mode: 'show', targets: [`field:${keyOf(q)}`, ...(pageId ? [`page:${pageId}`] : [])] }],
  }
}

const row = (key: string): FormRow => ({ columns: 1, cells: [{ field_key: key, span: 1 }] })

/**
 * The layout: one row per field; steps at page breaks, or one answer per
 * step (a heading travels with the question after it). More steps than the
 * form allows (20) fall back to grouping.
 */
export function buildFormLayout(spec: WizardSpec): FormLayout {
  const fields = spec.questions.filter((q) => q.kind !== 'page_break')
  const rules: FormRule[] = []
  // The animated thank-you page (lib/forms/success-defaults.ts, shared with the Agent).
  const submitted_page = defaultSubmittedPage({ heading: spec.look.success.heading, message: spec.look.success.message, submitAnother: spec.audience.multiple_responses })
  const animation = defaultFormAnimation()
  let pages: FormPage[] | null = null
  if (spec.look.layout === 'steps' && spec.questions.some((q) => q.kind === 'page_break')) {
    const groups: WizardQuestion[][] = [[]]
    for (const q of spec.questions) {
      if (q.kind === 'page_break') { if (groups[groups.length - 1].length) groups.push([]) } else groups[groups.length - 1].push(q)
    }
    pages = toPages(groups.filter((g) => g.length))
  } else if (spec.look.layout === 'one_at_a_time') {
    const groups: WizardQuestion[][] = []
    let pending: WizardQuestion[] = []
    for (const q of fields) {
      pending.push(q)
      if (q.kind !== 'heading') { groups.push(pending); pending = [] }
    }
    if (pending.length) { if (groups.length) groups[groups.length - 1].push(...pending); else groups.push(pending) }
    pages = toPages(groups)
  }
  if (pages && pages.length > 1) {
    for (const page of pages) {
      const keys = page.rows.flatMap((r) => r.cells.map((c) => c.field_key))
      const answers = fields.filter((q) => keys.includes(keyOf(q)) && q.kind !== 'heading')
      for (const q of fields.filter((f) => keys.includes(keyOf(f)))) {
        // Alone on its step: the step hides with it (no empty step).
        const rule = conditionRule(spec, q, answers.length === 1 && answers[0] === q ? page.id : null)
        if (rule) rules.push(rule)
      }
    }
    return {
      rows: [], mode: 'steps', pages,
      page_settings: { indicator: spec.look.layout === 'one_at_a_time' ? 'progress' : 'numbered', resume: true },
      ...(rules.length ? { rules } : {}),
      submitted_page,
      animation,
    }
  }
  for (const q of fields) {
    const rule = conditionRule(spec, q)
    if (rule) rules.push(rule)
  }
  return { rows: fields.map((q) => row(keyOf(q))), ...(rules.length ? { rules } : {}), submitted_page, animation }
}

function toPages(groups: WizardQuestion[][]): FormPage[] {
  let merged = groups
  if (merged.length > 20) {
    const size = Math.ceil(merged.length / 20)
    merged = []
    for (let i = 0; i < groups.length; i += size) merged.push(groups.slice(i, i + size).flat())
  }
  return merged.map((group, i) => {
    const heading = group.find((q) => q.kind === 'heading')
    const first = group.find((q) => q.kind !== 'heading')
    return {
      id: `page_${i + 1}`,
      title: (heading?.label || (group.length === 1 && first ? first.label : '') || `Step ${i + 1}`).slice(0, 80),
      rows: group.map((q) => row(keyOf(q))),
    }
  })
}

export function buildFormHeader(spec: WizardSpec) {
  const h = spec.look.header
  if (!h.show) return null
  return {
    enabled: true,
    image: h.logo ? 'workspace_logo' : 'none',
    title: h.title || spec.name,
    ...(h.subtitle || spec.description ? { subtitle: (h.subtitle || spec.description || '').slice(0, 300) } : {}),
    align: 'center' as const,
  }
}

export function buildFormTheme(spec: WizardSpec) {
  const t = spec.look.theme
  if (t.kind === 'saved') return { source: 'saved', theme_id: t.theme_id }
  if (t.kind === 'accent') return { source: 'custom', overrides: { colors: { light: { accent: t.color }, dark: { accent: t.color } } } }
  return { source: 'workspace' }
}

export function buildFormButtons() {
  return [{ id: 'submit', label: 'Submit', kind: 'submit', style: 'primary' }]
}

/** The form service's input (lib/services/forms createForm / updateForm). */
export function buildFormInput(spec: WizardSpec) {
  return {
    name: spec.name,
    description: spec.description || null,
    tags: ['wizard'],
    fields: buildFormFields(spec),
    layout: buildFormLayout(spec),
    theme: buildFormTheme(spec),
    buttons: buildFormButtons(),
    header: buildFormHeader(spec),
    available_in_menu: spec.audience.internal && spec.audience.show_in_menu,
  }
}

/* ── Data table ──────────────────────────────────────────────────────── */

export interface WizardColumn { key: string; name: string; type: string; options?: string[] }

const COLUMN_TYPE: Record<Exclude<WizardQuestion['kind'], 'heading' | 'page_break'>, string> = {
  short_text: 'text', long_text: 'longtext', number: 'number', money: 'number', date: 'date', choice: 'select', choices: 'text',
  rating: 'number', nps: 'number', yes_no: 'select', email: 'text', phone: 'text', file: 'file',
  // Survey controls map through surveyColumns (a matrix: one column per statement).
  likert: 'select', matrix: 'select', slider: 'number', csat: 'number', ranking: 'text', image_choice: 'select', yes_no_maybe: 'select',
}

const SURVEY_KINDS: ReadonlySet<WizardQuestion['kind']> = new Set(['rating', 'nps', 'likert', 'matrix', 'slider', 'csat', 'ranking', 'image_choice', 'yes_no_maybe'])

/**
 * A question's data table columns with the submission path that fills each:
 * one column (key = the question key) for every kind, except a grid of
 * statements: one select column per statement, `<key>_<statement key>`.
 */
export function questionColumns(q: WizardQuestion, name: string = q.label): Array<{ key: string; name: string; type: string; options?: string[]; path: string }> {
  if (SURVEY_KINDS.has(q.kind)) {
    const field = questionField(q)
    if (field) return surveyColumns(field, name).map((c) => ({ key: c.key, name: c.name, type: c.type, ...(c.options ? { options: [...c.options] } : {}), path: c.path }))
  }
  const type = COLUMN_TYPE[q.kind as keyof typeof COLUMN_TYPE]
  return [{ key: keyOf(q), name, type, ...(q.kind === 'choice' ? { options: [...(q.options ?? [])] } : q.kind === 'yes_no' ? { options: YES_NO } : {}), path: keyOf(q) }]
}

/** The responses table's columns: one per answer question, then the system columns (status options when there is a review). */
export function buildTableColumns(spec: WizardSpec): WizardColumn[] {
  const columns: WizardColumn[] = []
  const names = new Set<string>()
  const unique = (name: string) => {
    let n = name.slice(0, 100) || 'Question'
    for (let i = 2; names.has(n.toLowerCase()); i++) n = `${name.slice(0, 95)} (${i})`
    names.add(n.toLowerCase())
    return n
  }
  for (const c of SYSTEM_COLUMNS) names.add(c.name.toLowerCase())
  for (const q of answerQuestions(spec)) {
    for (const c of questionColumns(q)) columns.push({ key: c.key, name: unique(c.name), type: c.type, ...(c.options ? { options: c.options } : {}) })
  }
  const approval = spec.approval.mode !== 'none'
  for (const c of SYSTEM_COLUMNS) {
    if (!approval && ['stage', 'decided_by', 'decided_at', 'decision_note'].includes(c.key)) continue
    if (c.key === 'stage' && spec.approval.mode !== 'multi') continue
    if (c.key === 'score' && !isQuiz(spec)) continue
    columns.push({
      key: c.key, name: c.name, type: c.type,
      ...(c.key === 'status' ? { options: approval ? [STATUS.pending, STATUS.approved, STATUS.declined, ...(usesChanges(spec) ? [STATUS.changes] : [])] : [STATUS.submitted] } : {}),
    })
  }
  return columns
}

/**
 * Columns for an update: the existing ones kept (never dropped — a removed
 * question keeps its column and data), new questions' columns appended,
 * options of select columns widened.
 */
export function mergeTableColumns(existing: WizardColumn[], next: WizardColumn[]): WizardColumn[] {
  const byKey = new Map(next.map((c) => [c.key, c]))
  const out: WizardColumn[] = existing.map((c) => {
    const n = byKey.get(c.key)
    if (!n) return c
    const options = c.options || n.options ? [...new Set([...(c.options ?? []), ...(n.options ?? [])])] : undefined
    return { ...c, name: n.name, ...(options ? { options } : {}) }
  })
  const have = new Set(existing.map((c) => c.key))
  const names = new Set(out.map((c) => c.name.toLowerCase()))
  for (const c of next) {
    if (have.has(c.key)) continue
    let name = c.name
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${c.name} (${i})`
    names.add(name.toLowerCase())
    out.push({ ...c, name })
  }
  return out
}

function usesChanges(spec: WizardSpec): boolean {
  return spec.approval.mode !== 'none' && spec.approval.stages.some((s) => s.outcomes.includes('changes'))
}

/* ── Quiz score ──────────────────────────────────────────────────────── */

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The quiz score as an expression over the submission (`{{=…}}`), or null without scored questions. */
export function scoreExpression(spec: WizardSpec): string | null {
  const parts: string[] = []
  for (const q of spec.questions) {
    if (!q.score || !q.key) continue
    const points = q.score.points ?? 1
    if (q.kind === 'choices') {
      const correct = q.score.correct
      const checks = correct.map((c) => `CONTAINS(TO_JSON(form.${q.key}), ${quote(JSON.stringify(c))})`)
      parts.push(`IF(AND(${checks.join(', ')}, COUNT(form.${q.key}) == ${correct.length}), ${points}, 0)`)
    } else {
      const correct = q.score.correct[0]
      parts.push(`IF(form.${q.key} == ${quote(correct)}, ${points}, 0)`)
    }
  }
  return parts.length ? `{{=SUM(${parts.join(', ')})}}` : null
}

/** The same score computed from a stored response (the results page), so old rows count too. */
export function scoreOf(spec: WizardSpec, values: Record<string, unknown>): number | null {
  if (!isQuiz(spec)) return null
  let total = 0
  for (const q of spec.questions) {
    if (!q.score || !q.key) continue
    const value = values[q.key]
    const points = q.score.points ?? 1
    if (q.kind === 'choices') {
      const picked = Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? value.split(/,\s*/) : []
      if (picked.length === q.score.correct.length && q.score.correct.every((c) => picked.includes(c))) total += points
    } else if (String(value ?? '') === q.score.correct[0]) total += points
  }
  return total
}

export function maxScore(spec: WizardSpec): number {
  return spec.questions.reduce((sum, q) => sum + (q.score ? q.score.points ?? 1 : 0), 0)
}

/* ── Workflow ────────────────────────────────────────────────────────── */

export interface WizardWorkflowRefs {
  formId: string
  formName: string
  tableId: string
  tableName: string
}

interface Node { id: string; type: string; label: string; position: { x: number; y: number }; config: Record<string, unknown>; onError?: string }
interface Edge { id: string; source: string; target: string; label?: string }

export interface WizardWorkflow {
  name: string
  description: string
  trigger_type: 'form_submitted'
  trigger_config: Record<string, unknown>
  nodes: Node[]
  edges: Edge[]
}

export const RESPONSE_ROW_VAR = 'response_row_id'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The answers as read-only fields on a reviewer's task (values from the submission). */
export function reviewFields(spec: WizardSpec): TaskFieldDef[] {
  const out: TaskFieldDef[] = []
  for (const q of spec.questions) {
    const field = questionField(q)
    if (!field) continue
    if (field.type === 'heading') { out.push(field); continue }
    const { required: _required, ...rest } = field
    void _required
    out.push({ ...rest, read_only: true, default: `{{form.${field.key}}}` } as TaskFieldDef)
  }
  out.push({ key: 'review_note', label: 'Your comments', type: 'textarea', help_text: 'Shown to the person who submitted it when you decline or ask for changes.', max_length: 2000 })
  return out
}

function assigneeConfig(stage: WizardStage): Record<string, unknown> {
  const a = stage.assignee
  switch (a.kind) {
    case 'person': return { assignment_type: 'individual', assignee_id: a.user_id }
    case 'manager': return { assignment_type: 'individual', assignee_variable: '{{approver_id}}' }
    case 'team': return { assignment_type: 'team', team_id: a.team_id }
    case 'group': return { assignment_type: 'aad_group', aad_group_id: a.group_id, ...(a.group_name ? { aad_group_name: a.group_name } : {}), aad_group_mode: 'claim', aad_include_nested: true }
  }
}

const OUTCOME_TEXT: Record<StageOutcome, string> = STAGE_OUTCOME_LABELS

/**
 * The workflow: "Form submitted" → save the row → end, or with a review:
 * → (manager lookup) → stage 1 → Approve → … → last stage → Approve →
 * Approved; Decline / Ask for changes at any stage → written back, the
 * requester emailed (each branch has its own steps — no joins).
 */
export function buildWorkflow(spec: WizardSpec, refs: WizardWorkflowRefs): WizardWorkflow {
  const nodes: Node[] = []
  const edges: Edge[] = []
  let y = 60
  const X = 400
  const add = (node: Omit<Node, 'position'> & { position?: { x: number; y: number } }) => {
    nodes.push({ ...node, position: node.position ?? { x: X, y } } as Node)
    if (!node.position) y += 140
    return node.id
  }
  const link = (source: string, target: string, label?: string) => {
    edges.push({ id: `e-${source}-${target}`, source, target, ...(label ? { label } : {}) })
  }
  const approval = spec.approval.mode !== 'none'
  const score = scoreExpression(spec)

  add({ id: 'trigger', type: 'form_submitted', label: `"${refs.formName}" submitted`, config: { form_id: refs.formId, form_name: refs.formName } })
  const columnValues: Record<string, string> = {}
  for (const q of answerQuestions(spec)) for (const c of questionColumns(q)) columnValues[c.key] = `{{form.${c.path}}}`
  Object.assign(columnValues, {
    reference: '{{submission.reference}}',
    submitted_by: '{{submitted_by_name}}',
    submitted_by_email: '{{submitted_by_email}}',
    submitted_at: '{{submitted_at}}',
    status: approval ? STATUS.pending : STATUS.submitted,
    submission_id: '{{form_submission_id}}',
    ...(score ? { score } : {}),
    ...(spec.approval.mode === 'multi' ? { stage: spec.approval.stages[0].name } : {}),
  })
  add({
    id: 'save', type: 'update_data_table', label: 'Save the response',
    config: { table_id: refs.tableId, table_name: refs.tableName, operation: 'insert', column_values: columnValues, output_row_id_var: RESPONSE_ROW_VAR },
  })
  link('trigger', 'save')
  if (!approval) {
    add({ id: 'done', type: 'end_workflow', label: 'Saved', config: { reason: 'Response {{submission.reference}} saved' } })
    link('save', 'done')
    return finish(spec, refs, nodes, edges)
  }

  let previous = 'save'
  const stages = spec.approval.stages
  if (stages.some((s) => s.assignee.kind === 'manager')) {
    const fallback = stages.find((s) => s.assignee.kind === 'manager')!.assignee as { fallback_user_id: string }
    add({ id: 'manager', type: 'set_variable', label: "Find the requester's manager", config: { name: 'approver_id', expression: `{{=COALESCE(submitted_by_manager_id, ${quote(fallback.fallback_user_id)})}}` } })
    link(previous, 'manager')
    previous = 'manager'
  }
  const fields = reviewFields(spec)
  const updateRow = (id: string, label: string, values: Record<string, string>, pos: { x: number; y: number }) => add({
    id, type: 'update_data_table', label, position: pos,
    config: { table_id: refs.tableId, table_name: refs.tableName, operation: 'update', row_id: `{{${RESPONSE_ROW_VAR}}}`, column_values: values },
  })
  const decided = { decided_by: '{{actioned_by_name}}', decided_at: '{{=NOW()}}', decision_note: '{{task_data.review_note}}' }
  const notify = (id: string, subject: string, body: string, pos: { x: number; y: number }) => add({
    id, type: 'send_email', label: 'Email the requester', position: pos, onError: 'continue',
    config: { to: '{{submitted_by_email}}', subject, body },
  })
  const endNode = (id: string, reason: string, pos: { x: number; y: number }) => add({ id, type: 'end_workflow', label: 'Done', position: pos, config: { reason } })
  const ref = '{{submission.reference}}'
  const name = esc(refs.formName)

  for (const [i, stage] of stages.entries()) {
    const taskId = `stage_${i + 1}`
    const last = i === stages.length - 1
    const outcomes = (['approve', 'decline', 'changes'] as StageOutcome[]).filter((o) => stage.outcomes.includes(o))
    if (i > 0 && spec.approval.mode === 'multi') {
      const id = `stage_${i + 1}_start`
      updateRow(id, `Now at: ${stage.name}`, { stage: stage.name }, { x: X, y })
      y += 140
      link(previous, id, i > 0 ? OUTCOME_TEXT.approve : undefined)
      previous = id
    }
    add({
      id: taskId, type: 'user_task', label: stage.name,
      config: {
        task_title: `${stage.name}: ${refs.formName} from {{submitted_by_name}} (${ref})`,
        task_description: `<p><strong>{{submitted_by_name}}</strong> submitted <strong>${name}</strong> (reference ${ref}). Check the answers below and choose ${outcomes.map((o) => `<strong>${OUTCOME_TEXT[o]}</strong>`).join(', ')}.</p>${stages.length > 1 ? `<p>Stage ${i + 1} of ${stages.length}: ${esc(stage.name)}.</p>` : ''}`,
        task_priority: 'medium',
        outcomes: outcomes.map((o) => OUTCOME_TEXT[o]),
        ...assigneeConfig(stage),
        due_date_mode: 'relative', due_offset_amount: spec.approval.due_days, due_offset_unit: 'days',
        reminders: [{ offset_minutes: 1440 }],
        fields,
      },
    })
    // The first stage follows the save (or the manager lookup); later stages follow the previous stage's Approve.
    link(previous, taskId, i > 0 && spec.approval.mode !== 'multi' ? OUTCOME_TEXT.approve : undefined)
    const branchY = y
    y += 140
    // Decline / Ask for changes: their own branch per stage.
    let bx = X + 300
    for (const o of outcomes.filter((x) => x !== 'approve')) {
      const status = o === 'decline' ? STATUS.declined : STATUS.changes
      const rowId = `${taskId}_${o}`
      updateRow(rowId, `Record: ${status.toLowerCase()}`, { status, ...decided }, { x: bx, y: branchY + 140 })
      link(taskId, rowId, OUTCOME_TEXT[o])
      let tail = rowId
      if (spec.approval.notify_requester) {
        const mailId = `${rowId}_mail`
        notify(mailId,
          o === 'decline' ? `Your ${refs.formName} (${ref}) was declined` : `Changes requested: ${refs.formName} (${ref})`,
          `<p>Hello {{submitted_by_name}},</p><p>Your response to <strong>${name}</strong> (reference ${ref}) ${o === 'decline' ? 'was declined' : 'needs some changes'} by {{actioned_by_name}} at the ${esc(stage.name)} stage.</p><p>{{task_data.review_note}}</p>${o === 'changes' ? '<p>Please submit the form again with the changes.</p>' : ''}`,
          { x: bx, y: branchY + 280 })
        link(tail, mailId)
        tail = mailId
      }
      const endId = `${rowId}_end`
      endNode(endId, `${status} at ${stage.name}`, { x: bx, y: branchY + 420 })
      link(tail, endId)
      bx += 300
    }
    if (last) {
      updateRow('approved', 'Record: approved', { status: STATUS.approved, ...decided, ...(spec.approval.mode === 'multi' ? { stage: 'Done' } : {}) }, { x: X, y })
      y += 140
      link(taskId, 'approved', OUTCOME_TEXT.approve)
      let tail = 'approved'
      if (spec.approval.notify_requester) {
        notify('approved_mail', `Your ${refs.formName} (${ref}) was approved`,
          `<p>Hello {{submitted_by_name}},</p><p>Good news: your response to <strong>${name}</strong> (reference ${ref}) was approved by {{actioned_by_name}}.</p><p>{{task_data.review_note}}</p>`,
          { x: X, y })
        y += 140
        link(tail, 'approved_mail')
        tail = 'approved_mail'
      }
      endNode('done', `${STATUS.approved}`, { x: X, y })
      y += 140
      link(tail, 'done')
    } else {
      previous = taskId
    }
  }
  return finish(spec, refs, nodes, edges)
}

function finish(spec: WizardSpec, refs: WizardWorkflowRefs, nodes: Node[], edges: Edge[]): WizardWorkflow {
  const mode = spec.approval.mode
  return {
    name: `${spec.name}: ${mode === 'none' ? 'save responses' : 'review and approval'}`.slice(0, 120),
    description: mode === 'none'
      ? `Made by the form wizard: saves each response to "${refs.formName}" in the "${refs.tableName}" data table.`
      : `Made by the form wizard: saves each response to "${refs.formName}" in the "${refs.tableName}" data table, then ${APPROVAL_MODE_LABELS[mode].toLowerCase()} and the decision is written back${spec.approval.notify_requester ? ' and emailed to the requester' : ''}.`,
    trigger_type: 'form_submitted',
    trigger_config: {},
    nodes,
    edges,
  }
}

/* ── Reports ─────────────────────────────────────────────────────────── */

export interface WizardReport { key: string; name: string; description: string; category: string; config: ReportConfig }

const dataCol = (key: string) => `data_${key}`

/** The saved report on the responses table: every response, with summary charts. */
export function buildReports(spec: WizardSpec, tableId: string): WizardReport[] {
  // ONE report per form: every response with every question as a column (plus
  // reference, who / when and — when they apply — status, decision and score).
  // Summary charts (buildResponseCharts) sit above the table; the results
  // page keeps its own charts per question.
  const answers = answerQuestions(spec).filter((q) => q.kind !== 'file')
  const approval = spec.approval.mode !== 'none'
  const columns = [
    dataCol('reference'), 'created_at', dataCol('submitted_by'),
    ...answers.flatMap((q) => questionColumns(q).map((c) => dataCol(c.key))),
    ...(approval ? [dataCol('status'), dataCol('decided_by'), dataCol('decided_at'), dataCol('decision_note')] : []),
    ...(isQuiz(spec) ? [dataCol('score')] : []),
  ]
  return [{
    key: 'responses', name: `${spec.name}: responses`.slice(0, 120),
    description: 'Every response with all the questions, newest first, with summary charts (made by the form wizard).', category: 'Forms',
    config: { data_source: `custom_table_${tableId}`, filters: [], source_inputs: {}, columns, visualization: 'table', sort: { field: 'created_at', direction: 'desc' }, row_limit: 1000, charts: buildResponseCharts(spec) } as ReportConfig,
  }]
}

/** Question kinds worth a summary chart, best first within a form's question order. */
const CHART_KINDS: ReadonlySet<WizardQuestion['kind']> = new Set(['nps', 'rating', 'csat', 'likert', 'yes_no_maybe', 'yes_no', 'choice', 'image_choice', 'slider'])
/** Question charts at most (within MAX_REPORT_CHARTS). */
const MAX_QUESTION_CHARTS = 3

/** One question → a summary chart (null: not chart-worthy, e.g. free text, several answers, a grid). */
function questionChart(q: WizardQuestion, index: number): ReportChartSpec | null {
  if (!CHART_KINDS.has(q.kind)) return null
  if (q.kind === 'image_choice' && q.settings?.multiple) return null
  const cols = questionColumns(q)
  if (cols.length !== 1) return null
  const field = dataCol(cols[0].key)
  const id = `q${index + 1}_${cols[0].key}`.slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '_')
  const title = q.label.slice(0, 120) || 'Question'
  switch (q.kind) {
    // Survey stats semantics: NPS = % promoters (9–10) − % detractors (0–6).
    case 'nps': return { id, title: `${title}: NPS`.slice(0, 120), type: 'number', measure: { fn: 'nps', field } }
    case 'slider': return { id, title: `${title}: average`.slice(0, 120), type: 'number', measure: { fn: 'avg', field } }
    case 'rating': case 'csat': case 'likert':
      // Scales: every point in order, zero when unused.
      return { id, title, type: 'column', dimension: { field }, measure: { fn: 'count' }, categories: conditionChoices(q) ?? undefined }
    default: {
      const options = conditionChoices(q) ?? []
      return options.length && options.length <= 5
        ? { id, title, type: 'donut', dimension: { field }, measure: { fn: 'count' }, categories: options }
        : { id, title, type: 'bar', dimension: { field }, measure: { fn: 'count' }, top_n: 8 }
    }
  }
}

/**
 * The responses report's summary charts (at most MAX_REPORT_CHARTS):
 * total responses, responses over the last 90 days, by day of the week and
 * by hour of the day (in the viewer's time zone), by status when there is a
 * review, average score and the score spread for a quiz, then up to three
 * charts for the most chart-worthy questions (NPS, ratings, scales, choices).
 */
export function buildResponseCharts(spec: WizardSpec): ReportChartSpec[] {
  const charts: ReportChartSpec[] = [
    { id: 'total', title: 'Total responses', type: 'number', measure: { fn: 'count' } },
    { id: 'over_time', title: 'Responses over time', type: 'area', dimension: { field: 'created_at', bucket: 'day' }, measure: { fn: 'count' }, range_days: 90 },
    { id: 'by_weekday', title: 'By day of the week', type: 'column', dimension: { field: 'created_at', bucket: 'day_of_week' }, measure: { fn: 'count' } },
    { id: 'by_hour', title: 'By hour of the day', type: 'column', dimension: { field: 'created_at', bucket: 'hour_of_day' }, measure: { fn: 'count' } },
  ]
  if (spec.approval.mode !== 'none') {
    charts.push({
      id: 'by_status', title: 'By status', type: 'donut', dimension: { field: dataCol('status') }, measure: { fn: 'count' },
      categories: [STATUS.pending, STATUS.approved, STATUS.declined, ...(usesChanges(spec) ? [STATUS.changes] : [])],
    })
  }
  if (isQuiz(spec)) {
    charts.push(
      { id: 'avg_score', title: 'Average score', type: 'number', measure: { fn: 'avg', field: dataCol('score') } },
      { id: 'score_spread', title: 'Scores', type: 'column', dimension: { field: dataCol('score') }, measure: { fn: 'count' }, sort: 'label', top_n: 20 },
    )
  }
  const room = Math.min(MAX_QUESTION_CHARTS, MAX_REPORT_CHARTS - charts.length)
  const answers = answerQuestions(spec)
  const ranked = answers
    .map((q, i) => ({ q, i, rank: q.kind === 'nps' ? 0 : ['rating', 'csat', 'likert'].includes(q.kind) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
  let added = 0
  for (const { q, i } of ranked) {
    if (added >= room) break
    const chart = questionChart(q, i)
    if (chart) { charts.push(chart); added++ }
  }
  return charts
}

/* ── The plan (step 7) ───────────────────────────────────────────────── */

export interface WizardPlanItem { kind: 'form' | 'table' | 'workflow' | 'reports' | 'results' | 'access'; title: string; detail: string }

/** What Create will make, in plain words (the review step and the API's dry run). */
export function wizardPlan(input: WizardSpec): WizardPlanItem[] {
  // A draft's questions have no keys yet: everything below (columns, reports) needs them.
  const spec = assignWizardKeys(input)
  const answers = answerQuestions(spec)
  const columns = buildTableColumns(spec)
  const stages = spec.approval.stages
  const items: WizardPlanItem[] = [
    { kind: 'form', title: `Form "${spec.name}"`, detail: `${answers.length} question${answers.length === 1 ? '' : 's'}${spec.look.layout === 'single' ? ', all on one page' : spec.look.layout === 'steps' ? ', in steps' : ', one question at a time'}` },
    { kind: 'table', title: `Data table "${spec.name} responses"`, detail: `${columns.length} columns: one per question, plus reference, who and when${spec.approval.mode !== 'none' ? ', status and decision' : ''}${isQuiz(spec) ? ' and score' : ''}` },
    {
      kind: 'workflow', title: `Workflow "${buildWorkflowName(spec)}"`,
      detail: spec.approval.mode === 'none' ? 'Saves every response in the data table' : `${APPROVAL_MODE_LABELS[spec.approval.mode]}: ${stages.map((s) => s.name).join(' → ')}; the decision is written back${spec.approval.notify_requester ? ' and emailed to the requester' : ''}`,
    },
    { kind: 'results', title: 'Results page', detail: `Responses list with search and filters, summary cards${spec.results.charts ? ' and charts' : ''}` },
  ]
  items.push({ kind: 'reports', title: 'A saved report', detail: 'Every response with all the questions and summary charts (responses over time, by weekday and hour, and more), in Reports, for you (share it from there)' })
  const who: string[] = []
  if (spec.audience.internal) who.push(spec.audience.who === 'everyone' ? 'everyone in the workspace' : 'the chosen roles and teams')
  if (spec.audience.public_link) who.push('anyone with the public link')
  items.push({ kind: 'access', title: 'Who fills it in', detail: who.join(' and ') + (spec.audience.multiple_responses ? '' : ' (one response each)') })
  return items
}

export function buildWorkflowName(spec: WizardSpec): string {
  return `${spec.name}: ${spec.approval.mode === 'none' ? 'save responses' : 'review and approval'}`.slice(0, 120)
}
