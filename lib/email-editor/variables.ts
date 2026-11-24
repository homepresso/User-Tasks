/**
 * Email template variables: the built-in catalog (what the engine fills by
 * itself when a Send Email step or a User Task notification renders a
 * template), detection of the `{{…}}` references a template uses, and the
 * declarations a template can carry (label / type / description / sample /
 * required) for the variables a workflow must map.
 *
 * Pure (no imports beyond types): shared by the editor (variables panel,
 * autocomplete, unknown-variable lint), the email template service
 * (declarations on save), the workflow designer (mapping table, validation)
 * and the engine (lib/email-editor/render.ts).
 */

export type EmailVariableGroup = 'Task' | 'Workflow' | 'Form' | 'Person' | 'Links' | 'Workspace'

export const EMAIL_VARIABLE_GROUPS: readonly EmailVariableGroup[] = ['Task', 'Workflow', 'Form', 'Person', 'Links', 'Workspace']

export interface BuiltinEmailVariable {
  name: string
  label: string
  description: string
  group: EmailVariableGroup
  /** Preview value (USD in money examples). */
  sample: string
}

/**
 * Variables the engine fills by itself. Every name here resolves without a
 * mapping on a Send Email step (run variables, the triggering task, and the
 * link helpers render.ts adds); the user_task_* names are set by a User Task
 * (its notification, and every later step).
 */
export const BUILTIN_EMAIL_VARIABLES: readonly BuiltinEmailVariable[] = [
  // Task (the User Task that sent the notification / the latest one)
  { name: 'user_task_title', label: 'Task title', description: 'Title of the User Task this email is about (set by a User Task step)', group: 'Task', sample: 'Review the quarterly access request' },
  { name: 'user_task_description', label: 'Task instructions (text)', description: 'The task instructions as plain text', group: 'Task', sample: 'Please review the submitted details and approve or return the request.' },
  { name: 'user_task_description_html', label: 'Task instructions (HTML)', description: 'The task instructions with their formatting (HTML bodies only)', group: 'Task', sample: '<p>Please review the <strong>submitted details</strong> and approve or return the request.</p>' },
  { name: 'user_task_id', label: 'Task id', description: 'Id of the User Task', group: 'Task', sample: 'task-preview' },
  { name: 'task.title', label: 'Triggering task title', description: 'Title of the task that started the run (task triggers)', group: 'Task', sample: 'Laptop purchase for the design team' },
  { name: 'task.status', label: 'Triggering task status', description: 'Status of the task that started the run', group: 'Task', sample: 'in_progress' },
  { name: 'task.priority', label: 'Triggering task priority', description: 'Priority of the task that started the run', group: 'Task', sample: 'high' },
  { name: 'task.due_date', label: 'Triggering task due date', description: 'Due date of the task that started the run', group: 'Task', sample: '2026-12-04' },
  { name: 'outcome', label: 'Outcome', description: 'Outcome of the latest completed User Task', group: 'Task', sample: 'Approved' },
  { name: 'outcome_notes', label: 'Outcome notes', description: 'Notes left with the latest outcome', group: 'Task', sample: 'Within budget — approved.' },
  // Workflow
  { name: 'workflow_name', label: 'Workflow name', description: 'Name of the running workflow', group: 'Workflow', sample: 'Purchase approval' },
  { name: 'run_id', label: 'Run id', description: 'Id of this workflow run', group: 'Workflow', sample: 'run-preview' },
  { name: 'workflow_started_at', label: 'Started at', description: 'When the run started (ISO 8601)', group: 'Workflow', sample: '2026-11-22T09:30:00Z' },
  { name: '_title', label: 'Run title', description: 'The run title set by a Set Title step', group: 'Workflow', sample: 'PO-1042 · $2,400.00' },
  // Form (the trigger form — Form submitted)
  { name: 'form_name', label: 'Form name', description: 'Name of the form that started the run', group: 'Form', sample: 'Purchase request' },
  { name: 'submitted_at', label: 'Submitted at', description: 'When the form was submitted', group: 'Form', sample: '2026-11-22T09:28:00Z' },
  // Person
  { name: 'submitted_by_name', label: 'Submitted by (name)', description: 'Who submitted the trigger form', group: 'Person', sample: 'Jordan Lee' },
  { name: 'submitted_by_email', label: 'Submitted by (email)', description: 'Email of who submitted the trigger form', group: 'Person', sample: 'jordan.lee@example.com' },
  { name: 'completed_by_name', label: 'Completed by (name)', description: 'Who completed the latest User Task', group: 'Person', sample: 'Sam Patel' },
  { name: 'completed_by_email', label: 'Completed by (email)', description: 'Email of who completed the latest User Task', group: 'Person', sample: 'sam.patel@example.com' },
  // Links
  { name: 'task_url', label: 'Task link', description: 'Link to the User Task (or the triggering task) in UserTasks', group: 'Links', sample: 'https://app.example.com/tasks/task-preview' },
  { name: 'app_url', label: 'App address', description: 'Address of this UserTasks workspace', group: 'Links', sample: 'https://app.example.com' },
  // Workspace
  { name: 'current_year', label: 'Current year', description: 'The year the email is sent (footers)', group: 'Workspace', sample: '2026' },
]

const BUILTIN_BY_NAME = new Map(BUILTIN_EMAIL_VARIABLES.map((v) => [v.name.toLowerCase(), v]))

/**
 * Roots the engine resolves from the run itself (form values, User Task
 * values, run variables the engine sets): never asked for as a mapping.
 */
const RUN_PATH_ROOTS = new Set([
  'form', 'task', 'task_data', 'submission', 'live', 'item', 'index',
  'task_id', 'tenant_id', 'workflow_id', 'workflow_started_by', 'workflow_started_via', 'workflow_owner_id', 'workflow_initiator_user_id',
  'trigger_type', 'user_task_event_id', 'event_id', 'actioned_by', 'actioned_by_name', 'completed_by', 'completed_at',
  'response_count', 'outcome_counts', 'responses', 'attachments', 'form_id', 'form_version', 'form_outcome', 'form_button',
  'form_submission_id', 'submitted_by', 'has_error', 'last_error', 'last_error_node',
])

/** `{{name}}` references (plain variables, not `{{=FUNC(...)}}`). */
const VARIABLE_RE = /\{\{([\w.\-[\]]+)\}\}/g

export type EmailVariableType = 'text' | 'html' | 'url' | 'email' | 'number' | 'date'
export const EMAIL_VARIABLE_TYPES: readonly EmailVariableType[] = ['text', 'html', 'url', 'email', 'number', 'date']

/** A variable a template declares (stored with the template, merged with what it uses). */
export interface EmailVariableDeclaration {
  name: string
  label?: string
  type?: EmailVariableType
  description?: string
  sample?: string
  required?: boolean
}

/** How a variable gets its value at send time. */
export type EmailVariableSource =
  /** Built-in: the engine fills it (catalog above). */
  | 'auto'
  /** A run path (`form.x`, `task_data.x`, `task.data.x`): read from the run; checked by the designer's wiring. */
  | 'run'
  /** The template's own variable: mapped on the workflow step (or read from a same-named run variable). */
  | 'custom'

export interface EmailTemplateVariable extends EmailVariableDeclaration {
  label: string
  type: EmailVariableType
  source: EmailVariableSource
  /** Used by the subject / HTML / text (false: declared but not used). */
  used: boolean
}

export function builtinEmailVariable(name: string): BuiltinEmailVariable | undefined {
  return BUILTIN_BY_NAME.get(String(name ?? '').toLowerCase())
}

export function emailVariableSource(name: string): EmailVariableSource {
  if (builtinEmailVariable(name)) return 'auto'
  const root = String(name).split(/[.[]/)[0].toLowerCase()
  if (RUN_PATH_ROOTS.has(root)) return 'run'
  if (/^user_task_/.test(root) || /_task_data$/.test(root)) return 'run'
  return 'custom'
}

/** Every distinct `{{variable}}` in these texts, in first-use order. */
export function detectTemplateVariables(...texts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of texts) {
    if (!text) continue
    for (const match of String(text).matchAll(VARIABLE_RE)) {
      const name = match[1]
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

/** `customer_name` → `Customer name`. */
export function humanizeVariableName(name: string): string {
  const last = String(name ?? '').split('.').pop() ?? ''
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-[\]]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : String(name ?? '')
}

function guessType(name: string): EmailVariableType {
  const n = name.toLowerCase()
  if (/(^|_)html$/.test(n)) return 'html'
  if (/(url|link|href)$/.test(n)) return 'url'
  if (/email$/.test(n)) return 'email'
  if (/(amount|total|count|qty|quantity|price|number)$/.test(n)) return 'number'
  if (/(date|_at|deadline)$/.test(n)) return 'date'
  return 'text'
}

const NAME_RE = /^[A-Za-z_][\w.\-[\]]{0,99}$/

/** Valid declarations only (name rules, known type, bounded text). */
export function normalizeVariableDeclarations(value: unknown): EmailVariableDeclaration[] {
  if (!Array.isArray(value)) return []
  const out: EmailVariableDeclaration[] = []
  const seen = new Set<string>()
  for (const raw of value.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = String(r.name ?? '').trim()
    if (!NAME_RE.test(name) || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
    const type = EMAIL_VARIABLE_TYPES.includes(r.type as EmailVariableType) ? (r.type as EmailVariableType) : undefined
    const decl: EmailVariableDeclaration = { name }
    const label = text(r.label, 120); if (label) decl.label = label
    if (type) decl.type = type
    const description = text(r.description, 500); if (description) decl.description = description
    const sample = typeof r.sample === 'string' && r.sample !== '' ? r.sample.slice(0, 2000) : undefined; if (sample !== undefined) decl.sample = sample
    if (r.required === true) decl.required = true
    out.push(decl)
  }
  return out
}

/**
 * The template's variables: every variable it uses (built-in, run path or
 * its own), plus custom declarations it no longer uses (kept, marked
 * unused). Declarations add label / type / description / sample / required.
 */
export function templateVariables(
  content: { subject?: string | null; html_body?: string | null; text_body?: string | null },
  declarations: unknown = [],
): EmailTemplateVariable[] {
  const declared = normalizeVariableDeclarations(declarations)
  const byName = new Map(declared.map((d) => [d.name.toLowerCase(), d]))
  const used = detectTemplateVariables(content.subject, content.html_body, content.text_body)
  const usedKeys = new Set(used.map((n) => n.toLowerCase()))
  const build = (name: string, isUsed: boolean): EmailTemplateVariable => {
    const decl = byName.get(name.toLowerCase())
    const builtin = builtinEmailVariable(name)
    return {
      name,
      label: decl?.label ?? builtin?.label ?? humanizeVariableName(name),
      type: decl?.type ?? (builtin ? (/_html$/.test(builtin.name) ? 'html' : builtin.group === 'Links' ? 'url' : 'text') : guessType(name)),
      ...(decl?.description ?? builtin?.description ? { description: decl?.description ?? builtin?.description } : {}),
      ...(decl?.sample ?? builtin?.sample ? { sample: decl?.sample ?? builtin?.sample } : {}),
      ...(decl?.required ? { required: true } : {}),
      source: emailVariableSource(name),
      used: isUsed,
    }
  }
  return [
    ...used.map((name) => build(name, true)),
    ...declared.filter((d) => !usedKeys.has(d.name.toLowerCase()) && emailVariableSource(d.name) === 'custom').map((d) => build(d.name, false)),
  ]
}

/**
 * Declarations to store on save: what the author wrote (label, type,
 * description, sample, required) for custom variables the template still
 * uses. The names themselves are always detected from the content
 * (templateVariables), so a bare name is not stored; built-in and run-path
 * variables never are.
 */
export function declarationsForSave(
  content: { subject?: string | null; html_body?: string | null; text_body?: string | null },
  declarations: unknown,
): EmailVariableDeclaration[] {
  const declared = normalizeVariableDeclarations(declarations)
  const byName = new Map(declared.map((d) => [d.name.toLowerCase(), d]))
  return detectTemplateVariables(content.subject, content.html_body, content.text_body)
    .filter((name) => emailVariableSource(name) === 'custom')
    .map((name) => byName.get(name.toLowerCase()))
    .filter((d): d is EmailVariableDeclaration => !!d && Object.keys(d).length > 1)
}

/**
 * Unknown variables: used by the template but neither built-in, a run path,
 * nor declared. (Undeclared custom variables still work — they read a
 * same-named run variable or a step mapping — but are worth flagging.)
 */
export function unknownTemplateVariables(names: string[], declarations: unknown = []): string[] {
  const declared = new Set(normalizeVariableDeclarations(declarations).map((d) => d.name.toLowerCase()))
  return names.filter((name) => emailVariableSource(name) === 'custom' && !declared.has(name.toLowerCase()))
}

/** Preview values: built-in samples, then declared samples (or `[Label]`). */
export function sampleValues(variables: EmailTemplateVariable[] | null, overrides: Record<string, unknown> = {}, appUrl = 'https://app.example.com'): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const v of BUILTIN_EMAIL_VARIABLES) values[v.name] = v.sample
  values.app_url = appUrl
  values.task_url = `${appUrl}/tasks/task-preview`
  for (const v of variables ?? []) {
    if (v.source === 'auto') continue
    if (values[v.name] !== undefined) continue
    values[v.name] = v.sample ?? `[${v.label}]`
  }
  return { ...values, ...overrides }
}

/** Snapshot a workflow step keeps of its template's variables (designer validation offline). */
export interface TemplateVariableSnapshot {
  name: string
  label: string
  source: EmailVariableSource
  required?: boolean
  sample?: string
  description?: string
  type?: EmailVariableType
}

export function templateVariableSnapshot(variables: EmailTemplateVariable[]): TemplateVariableSnapshot[] {
  return variables.filter((v) => v.used).map((v) => ({
    name: v.name, label: v.label, source: v.source,
    ...(v.required ? { required: true } : {}),
    ...(v.sample !== undefined ? { sample: v.sample } : {}),
    ...(v.description ? { description: v.description } : {}),
    type: v.type,
  }))
}

/** Is this mapping value filled? */
export function mappingFilled(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null
}

/**
 * Required custom variables a step leaves unmapped (designer validation).
 * Steps without a snapshot (older workflows) report nothing.
 */
export function unmappedRequiredVariables(snapshot: unknown, mappings: unknown): TemplateVariableSnapshot[] {
  if (!Array.isArray(snapshot)) return []
  const map = (mappings && typeof mappings === 'object' ? mappings : {}) as Record<string, unknown>
  return (snapshot as TemplateVariableSnapshot[]).filter((v) => v && v.source === 'custom' && v.required && !mappingFilled(map[v.name]))
}

/**
 * Auto-mapping: for each custom variable without a mapping, the first
 * available data path whose last segment has the same name
 * (case-insensitive). Candidates come in the designer's preferred order.
 */
export function autoMapVariables(variables: Array<{ name: string; source: EmailVariableSource }>, candidates: string[], existing: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of variables) {
    if (v.source !== 'custom' || mappingFilled(existing[v.name])) continue
    const want = v.name.split('.').pop()!.toLowerCase()
    const hit = candidates.find((path) => path.split('.').pop()!.toLowerCase() === want)
    if (hit) out[v.name] = `{{${hit}}}`
  }
  return out
}
