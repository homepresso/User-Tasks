/**
 * NintexWorkflow → UserTasks workflow graph, with a report item per action.
 *
 *   Request approval / Flexi task / Request review / Assign to-do → user_task (outcomes as branches)
 *   Send notification → send_email · Set variable → set_variable · Log in history → log
 *   Build string → text_template · Math → math · Regular expression → regex · Calculate date → date_math
 *   Collection operation (count / get / join / sort / remove duplicates) → collection_* steps
 *   Pause for / until → delay / pause_until · End / Terminate workflow → end_workflow
 *   Set a condition / Run if → condition · Switch → switch_case · Run parallel actions → parallel
 *   For each → loop · Loop (while) → condition + Go To Activity · Action set → its actions inline
 *   State machine → state variable + switch_case, Change state → the next state + Go To Activity
 *   Update item / Set field / Create item / Delete item / Query list → the SharePoint step an
 *     extension maps them to (a connected-list target), else clearly marked placeholders
 *   Call web service / Web request → http_request (credentials are never copied)
 *   Commit pending changes → not needed (UserTasks writes at once)
 *   everything else (UDAs, Xtensions, AD / Exchange, document generation …) → a labelled placeholder
 *
 * Values: {ItemProperty:F} → {{after.F}} on a SharePoint list target ({{item_f}}
 * start parameters on a standalone workflow), {WorkflowVariable:X} → {{x}}, {WFConstant:X} → a
 * workflow variable const_x to fill in, {Common:…} → the run context.
 */
import type { ImportReportItem, NintexActionMapping, WorkflowGraphNode } from '@/lib/extensions/sdk'
import { lowerBlocks, varName, type GBlock } from './graph'
import { translateInline } from './inline'
import { camlToODataFilter, camlToODataOrderBy, camlToText, parseCaml } from '../caml'
import { nintexName, type NintexAction, type NintexCondition, type NintexWorkflow } from './model'
import { startParameters, type StartParameter } from './columns'

export const ITEM_ID_VAR = 'sp_item_id'

/** A SharePoint list action, for an extension to map onto its own step. */
export interface NintexListAction {
  kind: 'update' | 'create' | 'delete' | 'query'
  label: string
  /** Update / create: internal field name → UserTasks template. */
  fields: Record<string, string>
  /** Update / delete: the workflow's own item (else another list's). */
  currentItem: boolean
  caml?: string
  top?: number
  outputVar?: string
  /** The CAML translated (OData $filter / $orderby, a readable form); exact: nothing was left out. */
  query?: { filter: string; orderby: string; text: string; exact: boolean; unsupported: string[]; listId: string | null; select: string[] }
}

export interface NintexMapEnv {
  /** SharePoint-bound import: item references read the trigger's item ({{after.F}}). */
  sharepoint?: boolean
  /** The extension's mapping of SharePoint list actions; null → a placeholder. */
  listAction?: (action: NintexListAction) => { node: Omit<WorkflowGraphNode, 'id'>; status?: ImportReportItem['status']; mappedTo: string; detail?: string } | null
  /** The extension's mapping of other (SharePoint-only) Nintex actions; null → a placeholder. */
  otherAction?: (action: { type: string; label: string; params: Record<string, string>; currentItem: boolean }) => NintexActionMapping | null
  /** A first step the target needs (e.g. remember the SharePoint item id). */
  firstStep?: WorkflowGraphNode | null
  /** Legacy: a connected list id (SharePoint-bound, no list mapping). */
  listId?: string | null
  standalone?: boolean
  /** Column names the list uses for the workflow's names (matched by display name): references and list-step fields move to them. */
  columnMap?: Record<string, string>
}

const OP: Record<string, string> = {
  equal: 'equals', equals: 'equals', notequal: 'not_equals', notequals: 'not_equals', greaterthan: 'gt', lessthan: 'lt', greaterthanorequal: 'gte', lessthanorequal: 'lte',
  contains: 'contains', notcontains: 'not_contains', isempty: 'is_empty', notisempty: 'is_not_empty', isnotempty: 'is_not_empty', startswith: 'starts_with', endswith: 'ends_with',
  equalnocase: 'equals', containsnocase: 'contains', matches: 'matches',
}
const APPROX = new Set(['equalnocase', 'containsnocase'])

/** Nintex inserted references → UserTasks templates. */
export function nintexTokens(text: string, vars: Map<string, string>, env: { standalone?: boolean; itemFields?: Set<string>; constants?: Set<string>; columnMap?: Record<string, string> } = {}): string {
  return String(text ?? '')
    .replace(/\{WorkflowVariable:([^}]+)\}/g, (_m, n: string) => `{{${vars.get(n) ?? varName(n)}}}`)
    .replace(/\{ItemProperty:([^}]+)\}/g, (_m, n: string) => {
      if (n === 'ID') return env.standalone ? '{{item_id}}' : '{{sp_item_id}}'
      const internal = n.replace(/\s+/g, '_x0020_')
      if (env.standalone) { env.itemFields?.add(n); return `{{item_${varName(internal)}}}` }
      return /^(EncodedAbsUrl|ServerUrl|ItemUrl)$/i.test(n) ? '{{item_url}}' : /^FileLeafRef$/i.test(n) ? '{{file_name}}' : `{{after.${mappedColumn(internal, env.columnMap)}}}`
    })
    .replace(/\{WFConstant:([^}]+)\}/g, (_m, n: string) => { env.constants?.add(n); return `{{const_${varName(n)}}}` })
    .replace(/\{Lookup:([^}]+)\}/g, (_m, n: string) => `{{lookup_${varName(n)}}}`)
    .replace(/\{Common:([^}]+)\}/g, (_m, n: string) => (/ItemUrl/i.test(n) ? '{{item_url}}' : /Initiator/i.test(n) ? '{{user.email}}' : /CurrentDate|Now|CurrentTime/i.test(n) ? '{{=NOW()}}' : /WebUrl|SiteUrl/i.test(n) ? '{{site_url}}' : /WorkflowInstanceId|InstanceId/i.test(n) ? '{{run_id}}' : /WorkflowName/i.test(n) ? '{{workflow_name}}' : /ItemDisplayName|ItemName/i.test(n) ? '{{after.Title}}' : ''))
}

/** A column name as the target list knows it (case-insensitive lookup in the column map). */
export function mappedColumn(name: string, columnMap: Record<string, string> | undefined): string {
  if (!columnMap) return name
  if (columnMap[name]) return columnMap[name]
  const hit = Object.keys(columnMap).find((k) => k.toLowerCase() === name.toLowerCase())
  return hit ? columnMap[hit] : name
}

/** Kinds by Nintex for SharePoint adapter type (the .nwp reader translates its classes to these). */
const KIND: Record<string, string> = {
  WFIfElseAdapter: 'if', NWRunIf2Adapter: 'runif', NWSwitchAdapter: 'switch', WFParallelAdapter: 'parallel', NWBusinessProcessAdapter: 'set',
  NWStateMachine2Adapter: 'statemachine', NWStateChangeAdapter: 'changestate', NWForEachLoopAdapter: 'foreach', NWLoopAdapter: 'while', NWLoopNTimesAdapter: 'ntimes',
  NWCommitAdapter: 'noop', NWSendMessageAdapter: 'email', SPSetVariableAdapter: 'setvar', NWWriteToHistoryListAdapter: 'log', SPUpdateItemWithKeyAdapter: 'update',
  SPSetFieldWithKeyAdapter: 'setfield', NWBuildStringAdapter: 'text', NWQueryListAdapter: 'query', NWCollectionAdapter: 'collection', NWRegularExpressionAdapter: 'regex',
  NWDelayForAdapter: 'delay', SPDelayUntilAdapter: 'pause_until', WFTerminateAdapter: 'end', NWCancelWorkflowAdapter: 'end', SPMathAdapter: 'math',
  SPSetCustomWorkflowStatusAdapter: 'status', NWApproverAdapter: 'task', NWReviewAdapter: 'task', NWMultiOutcomeAdapter: 'task', NWAssignTodoTaskAdapter: 'task', NWCollectDataAdapter: 'task',
  NWCalculateDateAdapter: 'date', NWCreateItemWithContentTypesAdapter: 'create', NWCreateSiteSpecificItemAdapter: 'create', SPDeleteItemWithKeyAdapter: 'delete',
  NWCallWebServiceAdapter: 'http', NWWebRequestAdapter: 'http',
}

/** The preview reader's synthetic names (K2 importer table). */
const LEGACY: Array<{ re: RegExp; kind: string }> = [
  { re: /RequestApproval|FlexiTask|AssignToDo|RequestReview|RequestData|AssignFlexiTask/i, kind: 'task' },
  { re: /SendNotification|Email/i, kind: 'email' }, { re: /SetVariable|ConvertValue/i, kind: 'setvar' }, { re: /BuildString|BuildDynamicString/i, kind: 'text' },
  { re: /MathOperation|DoCalculation/i, kind: 'math' }, { re: /RegularExpression|Regex/i, kind: 'regex' }, { re: /PauseUntil/i, kind: 'pause_until' }, { re: /Pause|Delay/i, kind: 'delay' },
  { re: /QueryList/i, kind: 'query' }, { re: /SetField|UpdateItem|UpdateMultipleItems/i, kind: 'update' }, { re: /CreateItem|CopyItem/i, kind: 'create' }, { re: /DeleteItem/i, kind: 'delete' },
  { re: /LogInHistory|LogToHistory/i, kind: 'log' }, { re: /EndWorkflow|Terminate/i, kind: 'end' }, { re: /RunParallel|Parallel/i, kind: 'parallel' },
  { re: /RunIf|SetCondition|Condition|Filter/i, kind: 'legacyif' }, { re: /ActionSet|Sequence/i, kind: 'set' },
]

/** Nintex actions that only make sense in SharePoint: an extension maps them (otherAction), never core. */
export const SHAREPOINT_ONLY = new Set(['NWSetItemPermissions', 'SPCheckOutItemWithKeyAdapter', 'NWCheckInItemWithKeyAdapter', 'NWSetModerationStatusAdapter', 'NWStartWorkflow2Adapter', 'SPWaitForWithKeyAdapter', 'SPWaitForDocumentStatusAdapter', 'SPCopyItemWithKeyAdapter', 'NWCopyToSharepointSite2Adapter', 'NWUpdateMultipleItemAdapter'])

const SECRET_PARAM = /pass(word)?|secret|token|apikey|api_key|credential/i

export interface MappedNintex {
  nodes: WorkflowGraphNode[]
  edges: Array<{ source: string; target: string; label?: string }>
  items: ImportReportItem[]
  variables: Array<{ name: string; type: string; description: string; start?: Omit<StartParameter, 'name' | 'type' | 'description'> }>
  score: number
  placeholders: number
  tasks: number
  /** Source actions read (enabled, excluding branches) and steps made (excluding the item step). */
  counts: { actions: number; disabled: number; steps: number }
  /** Nintex workflow constants used: they become variables to fill in. */
  constants: string[]
  /** Task assignees as written in Nintex (people, groups, references), per user task, for the importer to resolve. */
  assignees: Array<{ nodeId: string; item: number; refs: string[]; behaviours: string[] }>
}

export function mapNintex(wf: NintexWorkflow, env: NintexMapEnv = {}): MappedNintex {
  const standalone = !env.sharepoint
  const vars = new Map(wf.variables.map((v) => [v.name, varName(v.name)]))
  const itemFields = new Set<string>(), constants = new Set<string>()
  const extraVars = new Map<string, { type: string; description: string }>()
  const items: ImportReportItem[] = []
  const taskAssignees: MappedNintex['assignees'] = []
  let seq = 0, placeholders = 0, tasks = 0, depth = 0, actions = 0, disabled = 0
  const id = (p: string) => `${p}_${++seq}`
  const tokEnv = { standalone, itemFields, constants, columnMap: env.columnMap }
  const approximations: string[] = []
  // Inline functions (fn-…) become native expressions first; what has no equivalent stays as written.
  const t = (s: string | undefined) => {
    const r = translateInline(s ?? '', (tok) => nintexTokens(tok, vars, tokEnv))
    approximations.push(...r.approximate)
    return nintexTokens(r.text, vars, tokEnv)
  }
  const p = (a: NintexAction, ...names: string[]) => { for (const n of names) { const hit = Object.entries(a.params).find(([k]) => k.toLowerCase() === n.toLowerCase()); if (hit && hit[1] !== '') return hit[1] } return '' }
  const v = (a: NintexAction, ...names: string[]) => { for (const n of names) { const name = a.vars?.[n]; if (name) return vars.get(name) ?? ensureVar(name) } return '' }
  const ensureVar = (name: string, type = 'string', description?: string) => {
    const n = vars.get(name) ?? varName(name)
    if (!vars.has(name)) { vars.set(name, n); extraVars.set(n, { type, description: description ?? `Nintex "${name}"` }) }
    return n
  }
  const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  const what = (a: NintexAction) => (a.source && a.source !== a.type ? `${nintexName(a.type)} (${a.source})` : nintexName(a.type))
  const record = (a: NintexAction, status: ImportReportItem['status'], mappedTo: string, detail?: string, kind = 'action') => {
    items.push({ kind, name: a.label, status, mappedTo, detail: [what(a), detail].filter(Boolean).join(': ') })
  }
  const safeParams = (a: NintexAction) => JSON.stringify(Object.fromEntries(Object.entries(a.params).map(([k, val]) => [k, SECRET_PARAM.test(k) && val ? '(not imported)' : val.slice(0, 300)]))).slice(0, 1500)
  const todo = (a: NintexAction, why: string): GBlock => {
    placeholders += 1
    record(a, 'placeholder', 'placeholder', why)
    return { kind: 'node', node: { id: id('todo'), type: 'placeholder', label: short(`To rebuild: ${a.label}`), config: { note: `Nintex action "${a.label}" (${what(a)}) was not converted: ${why}.\nParameters: ${safeParams(a)}` } } }
  }
  const node = (a: NintexAction, n: WorkflowGraphNode, status: ImportReportItem['status'], mappedTo: string, detail?: string): GBlock => {
    record(a, status, mappedTo, detail)
    return { kind: 'node', node: n }
  }
  /** Inline functions left untranslated (no native equivalent) in a Nintex text. */
  const hasFns = (s: string) => /fn-[A-Za-z]+\(/.test(t(s))
  const lookupIn = (s: string) => /\{Lookup:/.test(s)

  const cond = (c: NintexCondition | null | undefined) => {
    const rules = (c?.rules ?? []).map((r) => ({ field: t(r.left), operator: OP[r.op.toLowerCase().replace(/\s/g, '')] ?? 'equals', value: t(r.right) }))
    const exact = Boolean(c?.exact) && (c?.rules ?? []).every((r) => OP[r.op.toLowerCase().replace(/\s/g, '')] && !APPROX.has(r.op.toLowerCase()) && !lookupIn(r.left + r.right))
    return { rules: rules.length ? rules : [{ field: 'Review: condition', operator: 'equals', value: '' }], logic: c?.logic ?? 'and', exact, text: c?.text ?? 'condition', read: rules.length > 0 }
  }
  // State machines being mapped: their switch node, state variable and next-state variable.
  const machines: Array<{ switchId: string; stateVar: string; nextVar: string; source?: string }> = []

  const blocks = (list: NintexAction[], d: number): GBlock[] => {
    depth = Math.max(depth, d)
    const out: GBlock[] = []
    for (const a of list) {
      if (a.enabled === false) {
        disabled += 1
        items.push({ kind: 'action', name: a.label, status: 'info', mappedTo: 'not imported', detail: `${what(a)}: disabled in Nintex` })
        continue
      }
      const kind = a.custom ? null : (KIND[a.type] ?? (wf.format === 'legacy' ? LEGACY.find((m) => m.re.test(a.type))?.kind : undefined))
      if (kind !== 'set' && kind !== 'noop') actions += 1
      if (!kind && !a.custom && env.otherAction) {
        const mapped = env.otherAction({ type: a.type, label: a.label, params: Object.fromEntries(Object.entries(a.params).filter(([k]) => !SECRET_PARAM.test(k)).map(([k, x]) => [k, /^(LookupField|FieldName)$/.test(k) && !/[{}]/.test(x) ? mappedColumn(x, env.columnMap) : t(x)])), currentItem: a.params.ThisItem === undefined || /true/i.test(a.params.ThisItem) })
        if (mapped) {
          out.push(node(a, { id: id('sp'), ...mapped.node, label: short(String(mapped.node.label ?? a.label)) } as WorkflowGraphNode, mapped.status ?? 'mapped', mapped.mappedTo, mapped.detail))
          for (const extra of mapped.nodes ?? []) out.push({ kind: 'node', node: { id: id('sp'), ...extra, label: short(String(extra.label ?? a.label)) } as WorkflowGraphNode })
          continue
        }
      }
      if (!kind) { out.push(todo(a, a.custom ? `custom action from ${a.custom}: rebuild it with a UserTasks step or an extension` : /UserDefinedAction/.test(a.type) ? 'user defined action (UDA): import or rebuild it as a sub-workflow' : SHAREPOINT_ONLY.has(a.type) ? (env.otherAction ? 'SharePoint action with no SharePoint step yet: rebuild it with the SharePoint items or documents steps' : 'SharePoint step: needs the SharePoint extension (enable and license it, then import again)') : 'no UserTasks equivalent in the importer')); continue }
      switch (kind) {
        case 'noop': items.push({ kind: 'action', name: a.label, status: 'info', mappedTo: 'not needed', detail: `${what(a)}: UserTasks saves item changes at once` }); break
        case 'set': {
          items.push({ kind: 'action', name: a.label, status: 'info', detail: `${what(a)}: its actions follow in order` })
          for (const b of a.branches) out.push(...blocks(b.actions, d))
          break
        }
        case 'task': {
          tasks += 1
          const outcomes = a.outcomes?.length ? a.outcomes : /Approv/i.test(a.type) ? ['Approve', 'Reject'] : ['Done']
          const title = t(p(a, 'TaskName', 'Title', 'Subject')) || a.label
          const assignees = (a.assignees ?? []).filter(Boolean)
          const detail = [assignees.length ? `assignees in Nintex: ${assignees.map((x) => t(x)).join(', ')} — choose the UserTasks assignee` : 'choose the assignee', ...(a.behaviours?.length ? [`also had ${a.behaviours.join(', ')}`] : [])].join('; ')
          const n: WorkflowGraphNode = { id: id('task'), type: 'user_task', label: short(title), config: { _output_prefix: `task_${tasks}`, task_title: title, task_description: t(p(a, 'TaskDescription', 'Body', 'Description', 'Message') || a.message?.body || ''), task_priority: /high|\(1\)/i.test(p(a, 'TaskPriority')) ? 'high' : 'medium', outcomes, assignment_type: 'individual', due_date_mode: 'relative', due_offset_amount: 3, due_offset_unit: 'days' } }
          taskAssignees.push({ nodeId: n.id, item: items.length, refs: (a.assignees ?? []).filter(Boolean), behaviours: a.behaviours ?? [] })
          items.push({ kind: 'action', name: a.label, status: 'partial', mappedTo: `user_task (${outcomes.join(' / ')})`, detail: `${what(a)}: ${detail}` })
          const branches = a.branches.length ? a.branches.slice(0, outcomes.length).map((b, i) => ({ label: outcomes[i], blocks: blocks(b.actions, d + 1) })) : []
          if (branches.some((b) => b.blocks.length)) out.push({ kind: 'if', node: n, branches, elseBlocks: null, noElse: true })
          else out.push({ kind: 'node', node: n, outcomes })
          break
        }
        case 'email': {
          const m = a.message ?? { to: [p(a, 'To', 'Recipients')].filter(Boolean), cc: [p(a, 'CC')].filter(Boolean), subject: p(a, 'Subject'), body: p(a, 'Body', 'Message') }
          const to = m.to.map((x) => t(x)).join('; '), cc = m.cc.map((x) => t(x)).join('; ')
          const people = [...m.to, ...m.cc].some((x) => !/@|\{\{|\{[A-Za-z]+:/.test(x))
          out.push(node(a, { id: id('email'), type: 'send_email', label: short(`Email: ${t(m.subject)}`), config: { to, cc, subject: t(m.subject), body: t(m.body) } }, people || !to || hasFns(m.body + m.subject) ? 'partial' : 'mapped', 'send_email', people ? 'recipients are SharePoint people / groups: use their e-mail addresses' : !to ? 'no recipient read: add one' : hasFns(m.body) ? 'an inline function (fn-…) has no UserTasks equivalent: rewrite it' : undefined))
          break
        }
        case 'setvar': {
          const assignments = a.assignments?.length ? a.assignments.map((x) => ({ name: vars.get(x.name) ?? ensureVar(x.name), expression: t(x.value) }))
            : (() => { const target = a.vars?.VariableName ?? a.vars?.Variable ?? p(a, 'Variable', 'VariableName'); return target ? [{ name: vars.get(target) ?? ensureVar(target), expression: t(p(a, 'Value')) }] : [] })()
          if (!assignments.length) { out.push(todo(a, 'no variable named')); break }
          const review = assignments.some((x) => /\{\{lookup_/.test(x.expression)) || /Convert/i.test(a.type)
          out.push(node(a, { id: id('setvar'), type: 'set_variable', label: short(`Set ${assignments.map((x) => x.name).join(', ')}`), config: { assignments } }, review ? 'partial' : 'mapped', 'set_variable', review ? 'the value is a lookup in another list: add a SharePoint items step to read it' : undefined))
          break
        }
        case 'log': out.push(node(a, { id: id('log'), type: 'log', label: short(`Log: ${t(p(a, 'Message', 'Text'))}`), config: { message: t(p(a, 'Message', 'Text')) } }, 'mapped', 'log')); break
        case 'text': {
          const target = v(a, 'Output', 'StoreResultIn', 'Variable') || p(a, 'StoreResultIn', 'Variable', 'Output')
          const tpl = p(a, 'Input', 'Text', 'Value', 'String')
          out.push(node(a, { id: id('text'), type: 'text_template', label: short(`Build ${target || 'text'}`), config: { template: t(tpl), output_var: vars.get(target) ?? (target ? target : 'text') } }, target && !hasFns(tpl) ? 'mapped' : 'partial', 'text_template', hasFns(tpl) ? 'an inline function (fn-…) has no UserTasks equivalent: rewrite it as an expression' : target ? undefined : 'no output variable'))
          break
        }
        case 'math': {
          const target = v(a, 'VariableName', 'Output', 'StoreResultIn')
          const opName = p(a, 'Operator').toLowerCase()
          const op = ({ add: '+', plus: '+', subtract: '-', minus: '-', multiply: '*', divide: '/', modulus: '%' } as Record<string, string>)[opName] ?? (p(a, 'Operator') || '+')
          out.push(node(a, { id: id('calc'), type: 'math', label: short(`Calculate ${target || 'value'}`), config: { expression: `${t(p(a, 'Operand1', 'Left')) || 0} ${op} ${t(p(a, 'Operand2', 'Right')) || 0}`, output_var: target || 'result' } }, target ? 'mapped' : 'partial', 'math'))
          break
        }
        case 'regex': {
          const mode = (p(a, 'Mode', 'Operation') || 'match').toLowerCase()
          const operation = mode === 'replace' ? 'replace' : mode === 'split' ? 'split' : mode === 'match' || mode === 'extract' ? 'match' : 'match'
          const target = v(a, 'Output', 'StoreResultIn') || 'regex_result'
          out.push(node(a, { id: id('regex'), type: 'regex', label: short(a.label), config: { input: t(p(a, 'Text', 'Input')), pattern: p(a, 'Pattern', 'Expression'), flags: /true/i.test(p(a, 'IgnoreCase')) ? 'gi' : 'g', operation, replace_with: t(p(a, 'Replace', 'Replacement')), output_var: target } }, ['replace', 'split', 'match'].includes(mode) ? 'mapped' : 'partial', `regex (${operation})`, mode === 'extract' ? 'Extract returns all matches: check the result' : undefined))
          break
        }
        case 'date': {
          const target = v(a, 'Output') || 'date_result'
          const units: Array<[string, string]> = [['Minutes', 'minutes'], ['Hours', 'hours'], ['Days', 'days'], ['Months', 'months'], ['Years', 'years']]
          const set = units.map(([k, u]) => [p(a, k), u] as [string, string]).filter(([val]) => val && val !== '0')
          const [amount, unit] = set[0] ?? ['0', 'days']
          out.push(node(a, { id: id('date'), type: 'date_math', label: short(`Calculate ${target}`), config: { date: t(p(a, 'Date')) || '{{=NOW()}}', operation: 'add', amount: t(amount), unit, output_var: target } }, set.length <= 1 ? 'mapped' : 'partial', 'date_math', set.length > 1 ? `adds ${set.map(([val, u]) => `${val} ${u}`).join(' + ')}: add a date_math step per unit` : undefined))
          break
        }
        case 'collection': {
          // Native list functions (lib/expression-functions.ts) in a Set variable step.
          const op = p(a, 'Operation').toLowerCase().replace(/\s+/g, '')
          const collVar = v(a, 'Target') || 'collection', outVar = v(a, 'Output') || ''
          const coll = `{{${collVar}}}`
          const rawVal = t(p(a, 'LookupFieldValue', 'Value'))
          const val = /^\{\{[^{}=]+\}\}$/.test(rawVal) ? rawVal : JSON.stringify(rawVal)
          const idxRaw = p(a, 'Index')
          const idxVar = a.vars?.Index
          const pos = idxVar ? `{{${vars.get(idxVar) ?? varName(idxVar)}}} + 1` : String((Number(idxRaw) || 0) + 1)
          const hasIndex = Boolean(idxVar) || (idxRaw !== '' && Number(idxRaw) >= 0)
          const assign: Record<string, Array<[string, string]>> = {
            count: [[outVar || 'result', `{{=COUNT(${coll})}}`]],
            get: [[outVar || 'result', `{{=INDEX(${coll}, ${pos})}}`]],
            add: [[collVar, hasIndex ? `{{=LIST_INSERT(${coll}, ${pos}, ${val})}}` : `{{=LIST_ADD(${coll}, ${val})}}`]],
            insert: [[collVar, `{{=LIST_INSERT(${coll}, ${pos}, ${val})}}`]],
            remove: [[collVar, `{{=LIST_REMOVE_AT(${coll}, ${pos})}}`]],
            removebyindex: [[collVar, `{{=LIST_REMOVE_AT(${coll}, ${pos})}}`]],
            removevalue: [[collVar, `{{=LIST_REMOVE(${coll}, ${val})}}`]],
            removebyvalue: [[collVar, `{{=LIST_REMOVE(${coll}, ${val})}}`]],
            exists: [[outVar || 'result', `{{=LIST_CONTAINS(${coll}, ${val})}}`]],
            indexof: [[outVar || 'result', `{{=LIST_INDEX_OF(${coll}, ${val}) - 1}}`]],
            clear: [[collVar, '{{=FROM_JSON("[]")}}']],
            pop: [[outVar || 'result', `{{=LAST(${coll})}}`], [collVar, `{{=LIST_REMOVE_AT(${coll}, COUNT(${coll}))}}`]],
            join: [[outVar || 'result', `{{=LIST_JOIN(${coll}, ${JSON.stringify(p(a, 'JoinDelimiter') || ', ')})}}`]],
            sort: [[outVar || collVar, `{{=LIST_SORT(${coll}, ${JSON.stringify(/desc/i.test(p(a, 'SortDirection')) ? 'desc' : 'asc')})}}`]],
            deduplicate: [[outVar || collVar, `{{=UNIQUE(${coll})}}`]], removeduplicates: [[outVar || collVar, `{{=UNIQUE(${coll})}}`]],
            reverse: [[outVar || collVar, `{{=REVERSE(${coll})}}`]],
          }
          const hit = assign[op]
          if (!hit) { out.push(todo(a, `collection operation "${op || '?'}" not recognised`)); break }
          out.push(node(a, { id: id('coll'), type: 'set_variable', label: short(a.label), config: { assignments: hit.map(([name, expression]) => ({ name, expression })) } }, 'mapped', `set_variable (${hit.map(([, e]) => e.match(/=([A-Z_]+)\(/)?.[1] ?? 'list').join(', ')})`))
          break
        }
        case 'delay': {
          const n = (k: string) => Number(p(a, k) || 0) || 0
          const minutes = n('Years') * 525600 + n('Months') * 43200 + n('Days') * 1440 + n('Hours') * 60 + n('Minutes')
          out.push(node(a, { id: id('wait'), type: 'delay', label: `Pause for ${minutes || 1} minutes`, config: { duration: minutes || 1, unit: 'minutes' } }, n('Months') || n('Years') || /true/i.test(p(a, 'BusinessHoursOnly')) ? 'partial' : 'mapped', 'delay', n('Months') || n('Years') ? 'months / years taken as 30 / 365 days' : /true/i.test(p(a, 'BusinessHoursOnly')) ? 'business hours only is not applied' : undefined))
          break
        }
        case 'pause_until': out.push(node(a, { id: id('wait'), type: 'pause_until', label: 'Pause until', config: { date: t(p(a, 'Date', 'Until')) } }, 'mapped', 'pause_until')); break
        case 'end': out.push(node(a, { id: id('stop'), type: 'end_workflow', label: 'End workflow', config: { reason: t(p(a, 'Message', 'Reason')) } }, 'mapped', 'end_workflow')); break
        case 'status': {
          const name = ensureVar('workflow_status', 'string', 'The Nintex custom workflow status')
          out.push(node(a, { id: id('status'), type: 'set_variable', label: short(`Status: ${t(p(a, 'Status'))}`), config: { assignments: [{ name, expression: t(p(a, 'Status')) }] } }, 'partial', 'set_variable workflow_status', 'the run shows its own status; the Nintex status text is kept in a variable (show it on the item with an update step)'))
          break
        }
        case 'http': {
          const method = (p(a, 'Mode') || (a.type === 'NWCallWebServiceAdapter' ? 'POST' : 'GET')).toUpperCase()
          const creds = Boolean(p(a, 'Username') || p(a, 'Password'))
          out.push(node(a, { id: id('http'), type: 'http_request', label: short(a.label), config: { url: t(p(a, 'Url', 'URL')), method, content_type: p(a, 'ContentType') || (a.type === 'NWCallWebServiceAdapter' ? 'text/xml' : ''), body: t(p(a, 'Content', 'Query')) } }, 'partial', 'http_request', [a.type === 'NWCallWebServiceAdapter' ? `SOAP call (${p(a, 'WebMethodName') || 'web method'}): check the envelope and the result parsing` : 'check the request and the result variables', creds ? 'the stored credentials were NOT imported: use a connection or secret' : null].filter(Boolean).join('; ')))
          break
        }
        case 'update': case 'setfield': case 'create': case 'delete': case 'query': {
          const fieldsList = a.fields?.length ? a.fields : kind === 'setfield' ? [{ name: p(a, 'LookupField', 'Field'), value: p(a, 'LookupFieldValue', 'Value') }] : kind === 'query' || kind === 'delete' ? [] : Object.entries(a.params).filter(([k]) => !/^(List|ListName|ListId|Item|Filter|ThisItem|LookupField|LookupFieldType|LookupFieldValue|Overwrite|Output|ContentType)$/i.test(k)).map(([name, value]) => ({ name, value }))
          const current = kind === 'setfield' || a.params.ThisItem === undefined || /true/i.test(a.params.ThisItem)
          const fields = Object.fromEntries(fieldsList.filter((f) => f.name).map((f) => [current && kind !== 'create' ? mappedColumn(f.name.replace(/\s+/g, '_x0020_'), env.columnMap) : f.name, t(f.value)]))
          const listAction: NintexListAction = {
            kind: kind === 'setfield' ? 'update' : kind as NintexListAction['kind'], label: a.label, fields, currentItem: kind !== 'create' && current,
            ...(kind === 'query' ? (() => {
              const caml = p(a, 'Query', 'CAML')
              const q = parseCaml(caml, (x) => t(x))
              return { caml, top: Number(p(a, 'ItemLimitLookup')) || q.rowLimit || 100, outputVar: v(a, 'Output') || undefined, query: { filter: camlToODataFilter(q.where), orderby: camlToODataOrderBy(q.orderBy), text: camlToText(q.where), exact: q.exact, unsupported: q.unsupported, listId: q.listId, select: q.viewFields } }
            })() : {}),
          }
          const mapped = env.listAction?.(listAction) ?? null
          if (!mapped) { out.push(todo(a, `${standalone ? 'SharePoint list action: this workflow has no SharePoint list — rebuild it with a data table, reference or connector step (or import onto a connected SharePoint list)' : 'SharePoint list action: no installed extension maps it'}${listAction.query ? `; query: ${listAction.query.text}${listAction.query.exact ? '' : ` (not translated: ${listAction.query.unsupported.join(', ')})`}` : ''}`)); break }
          const lookups = fieldsList.some((f) => lookupIn(f.value))
          const status = mapped.status ?? (lookups ? 'partial' : 'mapped')
          out.push(node(a, { id: id('sp'), ...mapped.node, label: short(String(mapped.node.label ?? a.label)) } as WorkflowGraphNode, status, mapped.mappedTo, [mapped.detail, lookups ? 'a value is a lookup in another list' : null].filter(Boolean).join('; ') || undefined))
          break
        }
        case 'parallel': {
          const branches = a.branches.map((b, i) => ({ label: b.label || `Branch ${i + 1}`, blocks: blocks(b.actions, d + 1) })).filter((b) => b.blocks.length)
          record(a, 'mapped', 'parallel')
          if (branches.length) out.push({ kind: 'parallel', node: { id: id('parallel'), type: 'parallel', label: short(a.label), config: { mode: 'parallel', branches: branches.map((b, i) => ({ label: b.label, order: i + 1 })) } }, branches })
          break
        }
        case 'if': case 'runif': case 'legacyif': {
          const c = kind === 'legacyif' ? legacyCond(a) : cond(a.condition)
          const yes = kind === 'legacyif' ? (a.branches.find((b) => /^(yes|true|body|run)/i.test(b.label)) ?? a.branches[0]) : a.branches[0]
          const no = kind === 'if' ? a.branches[1] : kind === 'legacyif' ? a.branches.find((b) => b !== yes) : undefined
          const label = short(a.label && !/^(Set a condition|Run if|Run If)$/i.test(a.label) ? a.label : `If ${c.text}`, 60)
          items.push({ kind: 'condition', name: a.label, status: c.exact ? 'mapped' : c.read ? 'partial' : 'placeholder', mappedTo: 'condition', detail: `${what(a)}: ${c.exact ? c.text : c.read ? `${c.text} — check the rule (case-insensitive / lookup / combined conditions)` : `condition "${c.text}" not converted: set the rule`}` })
          if (!c.read) placeholders += 1
          out.push({ kind: 'if', node: { id: id('if'), type: 'condition', label, config: { match_mode: 'first', has_else: true, branches: [{ label, logic: c.logic, rules: c.rules }] } }, branches: [{ label, blocks: yes ? blocks(yes.actions, d + 1) : [] }], elseBlocks: no ? blocks(no.actions, d + 1) : null })
          break
        }
        case 'switch': {
          const field = t(p(a, 'SwitchVariable'))
          const cases = a.branches.filter((b) => b.value)
          const other = a.branches.find((b) => !b.value)
          record(a, field ? 'mapped' : 'partial', 'switch_case')
          out.push({ kind: 'if', node: { id: id('switch'), type: 'switch_case', label: short(a.label), config: { field, cases: cases.map((b) => ({ value: b.value, label: b.value })), has_default: true } }, branches: cases.map((b) => ({ label: b.value!, blocks: blocks(b.actions, d + 1) })), elseBlocks: other ? blocks(other.actions, d + 1) : null, elseLabel: 'default' })
          break
        }
        case 'foreach': {
          const coll = v(a, 'Target'), item = v(a, 'Value') || 'item', index = v(a, 'Index') || 'index'
          record(a, coll ? 'mapped' : 'partial', 'loop')
          out.push({ kind: 'loop', node: { id: id('loop'), type: 'loop', label: short(a.label), config: { items: coll ? `{{${coll}}}` : '', item_var: item, index_var: index } }, body: blocks(a.branches[0]?.actions ?? [], d + 1) })
          break
        }
        case 'ntimes': {
          record(a, 'partial', 'loop_n_times', 'check the count')
          out.push({ kind: 'loop', node: { id: id('loop'), type: 'loop_n_times', label: short(a.label), config: { count: t(p(a, 'Count', 'NumberOfTimes', 'LoopCount')) || '1', index_var: 'i' } }, body: blocks(a.branches[0]?.actions ?? [], d + 1) })
          break
        }
        case 'while': {
          const c = cond(a.condition)
          const cid = id('loop')
          items.push({ kind: 'action', name: a.label, status: c.read ? 'partial' : 'placeholder', mappedTo: 'condition + goto_activity', detail: `${what(a)}: repeats while ${c.text} (a condition that jumps back with Go To Activity) — check that it ends` })
          if (!c.read) placeholders += 1
          const body = blocks(a.branches[0]?.actions ?? [], d + 1)
          const back: GBlock = { kind: 'node', node: { id: id('goto'), type: 'goto_activity', label: 'Repeat the loop', config: { target_node_id: cid, target_node_label: short(a.label) } }, terminal: true }
          out.push({ kind: 'if', node: { id: cid, type: 'condition', label: short(`While ${c.text}`, 60), config: { match_mode: 'first', has_else: true, branches: [{ label: 'Repeat', logic: c.logic, rules: c.rules }] } }, branches: [{ label: 'Repeat', blocks: [...body, back] }], elseBlocks: null })
          break
        }
        case 'statemachine': {
          const stateVar = ensureVar(a.stateVar || `state_${machines.length + 1}`, 'string', `State of the Nintex state machine "${a.label}"`)
          const nextVar = ensureVar(`${stateVar}_next`, 'string', `Next state of "${a.label}" (set by Change state)`)
          const switchId = id('states')
          const initial = p(a, 'InitialState', 'initialState') || a.branches[0]?.value || a.branches[0]?.label || ''
          const initialName = a.branches.find((b) => b.id === initial)?.label ?? initial
          machines.push({ switchId, stateVar, nextVar, source: a.stateVar })
          record(a, 'partial', 'set_variable + switch_case + goto_activity', `${a.branches.length} states; each state ends by jumping back to the state switch with the next state — run a test`)
          const states = a.branches.map((b) => ({
            label: b.label,
            blocks: [
              { kind: 'node', node: { id: id('setvar'), type: 'set_variable', label: 'Clear the next state', config: { assignments: [{ name: nextVar, expression: '' }] } } } as GBlock,
              ...blocks(b.actions, d + 1),
              { kind: 'node', node: { id: id('goto'), type: 'goto_activity', label: 'Go to the next state', config: { target_node_id: switchId, target_node_label: short(a.label), input_overrides: { [stateVar]: `{{${nextVar}}}` } } }, terminal: true } as GBlock,
            ],
          }))
          machines.pop()
          out.push({ kind: 'node', node: { id: id('setvar'), type: 'set_variable', label: short(`Start in ${initialName}`), config: { assignments: [{ name: stateVar, expression: initialName }] } } })
          out.push({ kind: 'if', node: { id: switchId, type: 'switch_case', label: short(a.label), config: { field: `{{${stateVar}}}`, cases: a.branches.map((b) => ({ value: b.label, label: b.label })), has_default: true } }, branches: states, elseBlocks: null, elseLabel: 'default' })
          break
        }
        case 'changestate': {
          const m = machines.find((x) => x.source && x.source === a.stateVar) ?? machines[machines.length - 1]
          const next = p(a, 'State')
          if (!m) { out.push(todo(a, 'Change state outside a state machine')); break }
          const end = /^end( state machine)?$/i.test(next) || next === ''
          out.push(node(a, { id: id('setvar'), type: 'set_variable', label: short(end ? 'End the state machine' : `Next state: ${next}`), config: { assignments: [{ name: m.nextVar, expression: end ? '' : next }] } }, 'mapped', 'set_variable (next state)'))
          break
        }
        default: out.push(todo(a, 'no UserTasks equivalent in the importer'))
      }
    }
    return out
  }
  const legacyCond = (a: NintexAction) => {
    const left = p(a, 'Field', 'Left', 'Value1'), right = p(a, 'Value', 'Right', 'Value2'), op = p(a, 'Operator').replace(/\s/g, '').toLowerCase()
    const c = cond({ logic: 'and', rules: left ? [{ left, op: op || 'equals', right }] : [], exact: false, text: `${left} ${op} ${right}` })
    return { ...c, exact: false }
  }

  const body = blocks(wf.actions, 0)
  const graph = lowerBlocks(env.firstStep ? [{ kind: 'node', node: env.firstStep }, ...body] : body)
  const score = Math.min(100, Math.round(actions * 1.5 + tasks * 6 + placeholders * 8 + Math.max(0, depth - 1) * 5))
  const variables = [
    ...(standalone ? [] : [{ name: ITEM_ID_VAR, type: 'number', description: 'The SharePoint item the workflow runs on' }]),
    ...wf.variables.map((x) => {
      const type = /number|integer|currency|double/i.test(x.type) ? 'number' : /bool|yes/i.test(x.type) ? 'boolean' : /date/i.test(x.type) ? 'date' : /arraylist|collection/i.test(x.type) ? 'array' : 'string'
      if (!x.startForm) return { name: vars.get(x.name)!, type, description: `Nintex variable "${x.name}" (${x.type})` }
      // Start form fields: start parameters (label, required, choices, default, date format).
      const { name: _n, type: _t, description, ...start } = startParameters([x])[0]
      return { name: vars.get(x.name)!, type: type === 'date' ? 'string' : type, description, start }
    }),
    ...[...extraVars.entries()].filter(([n]) => !wf.variables.some((x) => vars.get(x.name) === n)).map(([name, x]) => ({ name, type: x.type, description: x.description })),
    ...[...constants].map((c) => ({ name: `const_${varName(c)}`, type: 'string', description: `Nintex workflow constant "${c}": set its value (credentials belong in a connection or secret)` })),
    ...(standalone ? [...itemFields].map((f) => ({ name: `item_${varName(f.replace(/\s+/g, '_x0020_'))}`, type: 'string', description: `Was the SharePoint item field "${f}": pass it when starting the workflow` })) : []),
  ]
  const seen = new Set<string>()
  return {
    ...graph, items, variables: variables.filter((x) => !seen.has(x.name) && seen.add(x.name)), score, placeholders, tasks,
    counts: { actions, disabled, steps: graph.nodes.length - (env.firstStep ? 1 : 0) }, constants: [...constants], assignees: taskAssignees,
  }
}
