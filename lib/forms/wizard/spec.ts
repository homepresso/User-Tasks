/**
 * The form wizard's spec: everything a person answers in the wizard
 * (/forms/wizard), and what POST /api/v1/forms/wizard and the MCP
 * forms_wizard_create tool take. One zod schema is the contract for every
 * surface; lib/forms/wizard/build.ts turns a valid spec into the objects the
 * service creates (lib/services/form-wizard.ts).
 *
 * Plain words on purpose: question kinds are what people call them ("short
 * answer", "rating"), not field types; approval modes are who decides, not
 * workflow nodes. Pure and isomorphic.
 */

import { z } from 'zod'
import { RATING_ICONS, SURVEY_OPTION_ICONS } from '@/lib/forms/survey/controls'

/* ── Templates ───────────────────────────────────────────────────────── */

export const WIZARD_TEMPLATES = ['request', 'survey', 'quiz', 'registration', 'feedback', 'incident', 'blank'] as const
export type WizardTemplate = (typeof WIZARD_TEMPLATES)[number]

/* ── Questions ───────────────────────────────────────────────────────── */

export const QUESTION_KINDS = [
  'short_text', 'long_text', 'number', 'money', 'date', 'choice', 'choices', 'rating', 'nps',
  'yes_no', 'email', 'phone', 'file', 'heading', 'page_break',
  // Survey controls (lib/forms/survey/controls.ts).
  'likert', 'matrix', 'slider', 'csat', 'ranking', 'image_choice', 'yes_no_maybe',
] as const
export type QuestionKind = (typeof QUESTION_KINDS)[number]

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  short_text: 'Short answer',
  long_text: 'Long answer',
  number: 'Number',
  money: 'Money',
  date: 'Date',
  choice: 'Choice (pick one)',
  choices: 'Choices (pick any)',
  rating: 'Star rating',
  nps: 'Recommend score (0 to 10)',
  yes_no: 'Yes / no',
  email: 'Email',
  phone: 'Phone',
  file: 'File upload',
  heading: 'Section heading',
  page_break: 'Page break',
  likert: 'Agreement scale',
  matrix: 'Grid of statements',
  slider: 'Slider',
  csat: 'Smiley faces',
  ranking: 'Rank in order',
  image_choice: 'Picture choice',
  yes_no_maybe: 'Yes / no / maybe',
}

/** The order the question builder offers kinds in ("Add a question"). */
export const QUESTION_KIND_ORDER: QuestionKind[] = [
  'short_text', 'long_text', 'number', 'money', 'date', 'email', 'phone',
  'choice', 'choices', 'yes_no', 'yes_no_maybe', 'image_choice',
  'rating', 'csat', 'nps', 'likert', 'matrix', 'slider', 'ranking',
  'file', 'heading', 'page_break',
]

/** Kinds that hold no answer (layout only). */
export const LAYOUT_KINDS: ReadonlySet<QuestionKind> = new Set(['heading', 'page_break'])
/** Kinds with an options list. */
export const OPTION_KINDS: ReadonlySet<QuestionKind> = new Set(['choice', 'choices', 'likert', 'matrix', 'ranking', 'image_choice'])
/** Kinds that can't be what another question depends on (several answers in one). */
export const NO_CONDITION_KINDS: ReadonlySet<QuestionKind> = new Set(['matrix', 'ranking', 'file'])
/** Kinds a quiz can score (a correct answer to pick). */
export const SCORABLE_KINDS: ReadonlySet<QuestionKind> = new Set(['choice', 'choices', 'yes_no'])

export const CONDITION_OPS = ['is', 'is_not', 'contains', 'answered', 'not_answered', 'gt', 'lt'] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]
export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  is: 'is', is_not: 'is not', contains: 'includes', answered: 'is answered', not_answered: 'is not answered', gt: 'is more than', lt: 'is less than',
}
/** Operators that need a value. */
export const VALUE_OPS: ReadonlySet<ConditionOp> = new Set(['is', 'is_not', 'contains', 'gt', 'lt'])

export const WIZARD_LIMITS = {
  name: 120, description: 2000, label: 300, help: 500, questions: 100, options: 50, option: 120,
  stages: 5, stageName: 60, successHeading: 160, successMessage: 500, headerTitle: 120, headerSubtitle: 300,
  aiDescription: 2000, dueDays: 90, viewers: 50,
} as const

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const KEY_RE = /^[a-z0-9][a-z0-9_]{0,63}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_RE = /^#[0-9a-fA-F]{6}$/

const uuid = z.string().regex(UUID_RE, 'must be an id')

/** Starting options per kind (a new question, or a kind change). */
export const DEFAULT_OPTIONS: Partial<Record<QuestionKind, string[]>> = {
  choice: ['Option 1', 'Option 2'],
  choices: ['Option 1', 'Option 2'],
  likert: ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'],
  matrix: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'],
  ranking: ['Option 1', 'Option 2', 'Option 3'],
  image_choice: ['Option 1', 'Option 2', 'Option 3'],
}
const trimmed = (max: number) => z.string().trim().max(max)

export const QuestionConditionSchema = z.object({
  /** The id of an EARLIER question. */
  question: z.string().regex(ID_RE),
  op: z.enum(CONDITION_OPS),
  value: trimmed(WIZARD_LIMITS.option).optional(),
})
export type QuestionCondition = z.infer<typeof QuestionConditionSchema>

export const QuestionSchema = z.object({
  /** Stable within the spec (conditions point at it). */
  id: z.string().regex(ID_RE, 'Question ids use letters, digits, - and _'),
  kind: z.enum(QUESTION_KINDS),
  label: trimmed(WIZARD_LIMITS.label).min(1, 'Every question needs a label'),
  help: trimmed(WIZARD_LIMITS.help).optional(),
  required: z.boolean().optional(),
  options: z.array(trimmed(WIZARD_LIMITS.option).min(1)).max(WIZARD_LIMITS.options).optional(),
  /** matrix: the statements people rate (rows); the options are the scale (columns). */
  rows: z.array(trimmed(WIZARD_LIMITS.label).min(1)).max(30).optional(),
  /**
   * Survey settings: rating { max 2–10 (default 5), icon star | heart | thumb, half };
   * slider { min, max, step, unit }; csat { faces 3 | 5 }; nps { bands };
   * low_label / high_label (rating, slider, nps); image_choice { multiple, icons { option: icon } }.
   */
  settings: z.object({
    max: z.number().finite().optional(),
    min: z.number().finite().optional(),
    step: z.number().positive().finite().optional(),
    unit: trimmed(12).optional(),
    icon: z.enum(RATING_ICONS).optional(),
    half: z.boolean().optional(),
    faces: z.union([z.literal(3), z.literal(5)]).optional(),
    bands: z.boolean().optional(),
    low_label: trimmed(60).optional(),
    high_label: trimmed(60).optional(),
    multiple: z.boolean().optional(),
    icons: z.record(z.string().max(WIZARD_LIMITS.option), z.enum(SURVEY_OPTION_ICONS)).optional(),
  }).optional(),
  /** money: ISO currency code (default USD). */
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  /** "Show this question only if…" */
  show_if: QuestionConditionSchema.nullable().optional(),
  /** Quizzes: the correct answer(s) and the points for it (default 1). */
  score: z.object({ correct: z.array(trimmed(WIZARD_LIMITS.option)).min(1).max(WIZARD_LIMITS.options), points: z.number().int().min(1).max(100).optional() }).nullable().optional(),
  /**
   * The form field / data table column key. Set by the service when the form
   * is created and kept from then on, so renaming a question never moves its
   * data (omit it for new questions).
   */
  key: z.string().regex(KEY_RE).optional(),
})
export type WizardQuestion = z.infer<typeof QuestionSchema>

/* ── Look & feel ─────────────────────────────────────────────────────── */

export const WIZARD_LAYOUTS = ['single', 'steps', 'one_at_a_time'] as const
export type WizardLayout = (typeof WIZARD_LAYOUTS)[number]
export const WIZARD_LAYOUT_LABELS: Record<WizardLayout, string> = {
  single: 'All on one page',
  steps: 'In steps (at each page break)',
  one_at_a_time: 'One question at a time',
}

export const ThemeChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({ kind: z.literal('saved'), theme_id: uuid }),
  z.object({ kind: z.literal('accent'), color: z.string().regex(HEX_RE, 'Use a colour like #2563eb') }),
])
export type ThemeChoice = z.infer<typeof ThemeChoiceSchema>

export const LookSchema = z.object({
  theme: ThemeChoiceSchema.default({ kind: 'workspace' }),
  header: z.object({
    show: z.boolean().default(true),
    logo: z.boolean().default(true),
    title: trimmed(WIZARD_LIMITS.headerTitle).optional(),
    subtitle: trimmed(WIZARD_LIMITS.headerSubtitle).optional(),
  }).default({ show: true, logo: true }),
  layout: z.enum(WIZARD_LAYOUTS).default('single'),
  success: z.object({
    heading: trimmed(WIZARD_LIMITS.successHeading).optional(),
    message: trimmed(WIZARD_LIMITS.successMessage).optional(),
  }).default({}),
})
export type WizardLook = z.infer<typeof LookSchema>

/* ── Who fills it in ─────────────────────────────────────────────────── */

export const AudienceSchema = z.object({
  /** People in the workspace fill it in (signed in). */
  internal: z.boolean().default(true),
  /** everyone: any member who can submit forms; selected: the roles / teams below (Forms menu grants). */
  who: z.enum(['everyone', 'selected']).default('everyone'),
  role_ids: z.array(uuid).max(WIZARD_LIMITS.viewers).default([]),
  team_ids: z.array(uuid).max(WIZARD_LIMITS.viewers).default([]),
  /** List it in their sidebar Forms menu. */
  show_in_menu: z.boolean().default(true),
  /** A public link anyone can fill in without signing in (needs the workspace's "Allow anonymous forms"). */
  public_link: z.boolean().default(false),
  /** false: one response per person (signed-in people). */
  multiple_responses: z.boolean().default(true),
  /** Responses are accepted from / until (ISO date-time; absent = always). */
  opens_at: z.string().datetime({ offset: true }).nullable().optional(),
  closes_at: z.string().datetime({ offset: true }).nullable().optional(),
}).refine((a) => a.internal || a.public_link, { message: 'Choose who fills it in: people in the workspace, a public link, or both' })
  .refine((a) => !a.opens_at || !a.closes_at || a.opens_at < a.closes_at, { message: 'The closing date must be after the opening date' })
export type WizardAudience = z.infer<typeof AudienceSchema>

/* ── Review & approval ───────────────────────────────────────────────── */

export const APPROVAL_MODES = ['none', 'single', 'manager', 'team', 'multi'] as const
export type ApprovalMode = (typeof APPROVAL_MODES)[number]
export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  none: 'No review: just save the responses',
  single: 'One person approves',
  manager: "The person's manager approves",
  team: 'A team (anyone in it can pick it up)',
  multi: 'Several stages (for example review, then approve)',
}

export const STAGE_OUTCOMES = ['approve', 'decline', 'changes'] as const
export type StageOutcome = (typeof STAGE_OUTCOMES)[number]
export const STAGE_OUTCOME_LABELS: Record<StageOutcome, string> = { approve: 'Approve', decline: 'Decline', changes: 'Ask for changes' }

export const StageAssigneeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), user_id: uuid }),
  /** The submitter's manager (reporting lines, looked up when the form is submitted); else the fallback person. */
  z.object({ kind: z.literal('manager'), fallback_user_id: uuid }),
  z.object({ kind: z.literal('team'), team_id: uuid }),
  /** An Entra ID (AAD) group: anyone in it can claim the task. */
  z.object({ kind: z.literal('group'), group_id: z.string().trim().min(1).max(100), group_name: trimmed(200).optional() }),
])
export type StageAssignee = z.infer<typeof StageAssigneeSchema>

export const StageSchema = z.object({
  id: z.string().regex(ID_RE),
  name: trimmed(WIZARD_LIMITS.stageName).min(1, 'Every stage needs a name'),
  assignee: StageAssigneeSchema,
  /** Buttons the reviewer sees (Approve is always there). */
  outcomes: z.array(z.enum(STAGE_OUTCOMES)).min(1).default(['approve', 'decline']),
})
export type WizardStage = z.infer<typeof StageSchema>

export const ApprovalSchema = z.object({
  mode: z.enum(APPROVAL_MODES).default('none'),
  stages: z.array(StageSchema).max(WIZARD_LIMITS.stages).default([]),
  /** Email the person who submitted it when it is decided. */
  notify_requester: z.boolean().default(true),
  /** Each stage is due this many days after it starts. */
  due_days: z.number().int().min(1).max(WIZARD_LIMITS.dueDays).default(3),
}).superRefine((a, ctx) => {
  if (a.mode === 'none') return
  const want = a.mode === 'multi' ? [2, WIZARD_LIMITS.stages] : [1, 1]
  if (a.stages.length < want[0] || a.stages.length > want[1]) {
    ctx.addIssue({ code: 'custom', path: ['stages'], message: a.mode === 'multi' ? `Add 2 to ${WIZARD_LIMITS.stages} stages` : 'Add who approves' })
    return
  }
  const kinds: Partial<Record<ApprovalMode, StageAssignee['kind'][]>> = { single: ['person'], manager: ['manager'], team: ['team', 'group'] }
  const allowed = kinds[a.mode]
  for (const [i, stage] of a.stages.entries()) {
    if (allowed && !allowed.includes(stage.assignee.kind)) ctx.addIssue({ code: 'custom', path: ['stages', i, 'assignee'], message: `"${APPROVAL_MODE_LABELS[a.mode]}" needs ${allowed.join(' or ')} as the approver` })
    if (!stage.outcomes.includes('approve')) ctx.addIssue({ code: 'custom', path: ['stages', i, 'outcomes'], message: 'Every stage needs an Approve button' })
  }
  if (new Set(a.stages.map((s) => s.id)).size !== a.stages.length) ctx.addIssue({ code: 'custom', path: ['stages'], message: 'Stage ids must be unique' })
})
export type WizardApproval = z.infer<typeof ApprovalSchema>

/* ── Results page ────────────────────────────────────────────────────── */

export const ResultsSchema = z.object({
  /** Charts per question (choices, ratings, recommend scores) on the results page, and saved reports for them. */
  charts: z.boolean().default(true),
  /** Besides the owner: roles and teams that may open the results page. */
  role_ids: z.array(uuid).max(WIZARD_LIMITS.viewers).default([]),
  team_ids: z.array(uuid).max(WIZARD_LIMITS.viewers).default([]),
})
export type WizardResults = z.infer<typeof ResultsSchema>

/* ── The spec ────────────────────────────────────────────────────────── */

export const WizardSpecSchema = z.object({
  version: z.literal(1).default(1),
  template: z.enum(WIZARD_TEMPLATES).default('blank'),
  name: trimmed(WIZARD_LIMITS.name).min(1, 'Give it a name'),
  description: trimmed(WIZARD_LIMITS.description).optional(),
  questions: z.array(QuestionSchema).min(1, 'Add at least one question').max(WIZARD_LIMITS.questions),
  look: LookSchema.default({ theme: { kind: 'workspace' }, header: { show: true, logo: true }, layout: 'single', success: {} }),
  audience: AudienceSchema.default({ internal: true, who: 'everyone', role_ids: [], team_ids: [], show_in_menu: true, public_link: false, multiple_responses: true }),
  approval: ApprovalSchema.default({ mode: 'none', stages: [], notify_requester: true, due_days: 3 }),
  results: ResultsSchema.default({ charts: true, role_ids: [], team_ids: [] }),
}).superRefine((spec, ctx) => {
  const ids = new Set<string>()
  const keys = new Set<string>()
  let answers = 0
  for (const [i, q] of spec.questions.entries()) {
    if (ids.has(q.id)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'id'], message: `Question id "${q.id}" is used twice` })
    if (q.key) {
      if (keys.has(q.key)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'key'], message: `Key "${q.key}" is used twice` })
      keys.add(q.key)
    }
    if (!LAYOUT_KINDS.has(q.kind)) answers++
    if (OPTION_KINDS.has(q.kind)) {
      const options = q.options ?? []
      const least = q.kind === 'choice' || q.kind === 'choices' ? 1 : 2
      if (options.length < least) ctx.addIssue({ code: 'custom', path: ['questions', i, 'options'], message: `"${q.label}" needs at least ${least === 1 ? 'one option' : 'two options'}` })
      if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) ctx.addIssue({ code: 'custom', path: ['questions', i, 'options'], message: `"${q.label}" has the same option twice` })
    }
    if (q.kind === 'matrix' && !(q.rows ?? []).length) ctx.addIssue({ code: 'custom', path: ['questions', i, 'rows'], message: `"${q.label}" needs at least one statement` })
    if (q.kind === 'matrix' && new Set((q.rows ?? []).map((r) => r.toLowerCase())).size !== (q.rows ?? []).length) ctx.addIssue({ code: 'custom', path: ['questions', i, 'rows'], message: `"${q.label}" has the same statement twice` })
    if (q.kind === 'likert' && (q.options ?? []).length > 11) ctx.addIssue({ code: 'custom', path: ['questions', i, 'options'], message: `"${q.label}" can have at most 11 points` })
    if (q.kind === 'rating' && q.settings?.max !== undefined && (!Number.isInteger(q.settings.max) || q.settings.max < 2 || q.settings.max > 10)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'settings', 'max'], message: `"${q.label}" goes up to a whole number from 2 to 10` })
    if (q.kind === 'slider' && (q.settings?.max ?? 100) <= (q.settings?.min ?? 0)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'settings', 'max'], message: `"${q.label}": the highest value must be more than the lowest` })
    if (q.score) {
      if (!SCORABLE_KINDS.has(q.kind)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'score'], message: `"${q.label}" can't be scored (only choice and yes / no questions)` })
      else if (q.kind !== 'yes_no' && q.score.correct.some((c) => !(q.options ?? []).includes(c))) ctx.addIssue({ code: 'custom', path: ['questions', i, 'score'], message: `The correct answer of "${q.label}" must be one of its options` })
      else if (q.kind === 'yes_no' && q.score.correct.some((c) => c !== 'Yes' && c !== 'No')) ctx.addIssue({ code: 'custom', path: ['questions', i, 'score'], message: `The correct answer of "${q.label}" must be Yes or No` })
    }
    if (q.show_if) {
      const source = spec.questions.slice(0, i).find((p) => p.id === q.show_if!.question)
      if (!source) ctx.addIssue({ code: 'custom', path: ['questions', i, 'show_if'], message: `"${q.label}" can only depend on a question before it` })
      else if (LAYOUT_KINDS.has(source.kind)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'show_if'], message: `"${q.label}" can't depend on a heading or page break` })
      else if (NO_CONDITION_KINDS.has(source.kind)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'show_if'], message: `"${q.label}" can't depend on "${source.label}" (${QUESTION_KIND_LABELS[source.kind].toLowerCase()})` })
      if (VALUE_OPS.has(q.show_if.op) && !String(q.show_if.value ?? '').trim()) ctx.addIssue({ code: 'custom', path: ['questions', i, 'show_if', 'value'], message: `Say what "${q.label}" depends on` })
      if (q.kind === 'page_break') ctx.addIssue({ code: 'custom', path: ['questions', i, 'show_if'], message: 'A page break cannot be conditional' })
    }
    ids.add(q.id)
  }
  if (answers < 1) ctx.addIssue({ code: 'custom', path: ['questions'], message: 'Add at least one question people answer' })
})
export type WizardSpec = z.infer<typeof WizardSpecSchema>
export type WizardSpecInput = z.input<typeof WizardSpecSchema>

/** A readable list of the spec's problems ("questions.2.options: … "), or null when valid. */
export function wizardSpecProblems(input: unknown): string[] | null {
  const parsed = WizardSpecSchema.safeParse(input)
  if (parsed.success) return null
  return parsed.error.issues.map((issue) => `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
}

/** Parse or throw with every problem (the service maps it to a 400). */
export function parseWizardSpec(input: unknown): WizardSpec {
  return WizardSpecSchema.parse(input)
}

/** A new question / stage id. */
export function newWizardId(prefix = 'q', taken: Iterable<string> = []): string {
  const used = new Set(taken)
  for (;;) {
    const id = `${prefix}_${Math.random().toString(36).slice(2, 8)}`
    if (!used.has(id)) return id
  }
}

/** Whether a question kind holds an answer. */
export function isAnswerKind(kind: QuestionKind): boolean {
  return !LAYOUT_KINDS.has(kind)
}

/**
 * The answers a "show only if" can pick from for a source question (null:
 * typed in — numbers, text). Rating 1…max, smiley faces 1…faces, recommend
 * score 0…10, the options of choice-like questions.
 */
export function conditionChoices(q: WizardQuestion): string[] | null {
  switch (q.kind) {
    case 'yes_no': return ['Yes', 'No']
    case 'yes_no_maybe': return ['Yes', 'No', 'Maybe']
    case 'rating': return Array.from({ length: Math.max(2, Math.min(10, Math.round(q.settings?.max ?? 5))) }, (_, i) => String(i + 1))
    case 'csat': return Array.from({ length: q.settings?.faces === 3 ? 3 : 5 }, (_, i) => String(i + 1))
    case 'nps': return Array.from({ length: 11 }, (_, i) => String(i))
    case 'choice': case 'choices': case 'likert': case 'image_choice': return q.options ?? []
    default: return null
  }
}

/** Whether "includes" fits a source question (several answers). */
export function conditionAllowsContains(q: WizardQuestion): boolean {
  return q.kind === 'choices' || (q.kind === 'image_choice' && q.settings?.multiple === true) || conditionChoices(q) === null
}
