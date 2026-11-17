/**
 * Nintex Workflow for Office 365 export package (.nwp) reader.
 *
 * The package is a zip: Workflow/Actions.xml (the action tree), Settings.xml
 * (title, start options), Variables.xml, Metadata.xml, Lists.xml, Manifest.xml
 * and Forms/FormN.xml|json (Nintex Forms for the start form and task forms).
 * Some exports are a gzip of one `ImportExportContainer` XML instead.
 *
 * Actions.xml: `WorkflowAction` elements with `Configuration` (Name — the
 * action's title, ServerInfo/ClassName, Properties/Property/Parameters
 * Name + Value), `Children` (containers: branches are #SequenceActivity
 * children named after the branch / state / outcome) and `Next` (the next
 * action of a sequence). Values: PrimitiveValue with a `{0}` template and
 * FormatValues (Variable, ListLookup [Current Item] field, WorkflowContext),
 * Collection (several values), Dictionary (conditions, item properties).
 *
 * The class names are translated to the Nintex for SharePoint adapter
 * names, so one mapper serves both formats.
 */
import { gunzipSync } from 'node:zlib'
import { local, parseXml, textOf, type XmlNode } from './xml'
import { decodeText } from './xml'
import { NintexFormatError, type NintexAction, type NintexCondition, type NintexFieldInfo, type NintexRule, type NintexVariable, type NintexWorkflow } from './model'
import { child, children } from './read-nwf'

/** .nwp class → Nintex for SharePoint adapter type (same mapping semantics). */
const CLASS_MAP: Record<string, string> = {
  SendNotificationActivity: 'NWSendMessageAdapter', Email: 'NWSendMessageAdapter',
  SetMultiVariablesActivity: 'SPSetVariableAdapter', Assign: 'SPSetVariableAdapter',
  WriteToHistory: 'NWWriteToHistoryListAdapter', UpdateListItem: 'SPUpdateItemWithKeyAdapter', SetField: 'SPSetFieldWithKeyAdapter',
  CreateListItem: 'NWCreateItemWithContentTypesAdapter', DeleteListItem: 'SPDeleteItemWithKeyAdapter',
  ConditionalBranch: 'WFIfElseAdapter', RunIf: 'NWRunIf2Adapter', Switch: 'NWSwitchAdapter', ParallelBlock: 'WFParallelAdapter',
  ActionSet: 'NWBusinessProcessAdapter', StateMachine: 'NWStateMachine2Adapter', SetNextState: 'NWStateChangeAdapter',
  SingleTask: 'NWMultiOutcomeAdapter', CompositeTask: 'NWMultiOutcomeAdapter', SetWorkflowStatus: 'SPSetCustomWorkflowStatusAdapter',
  StringBuilder: 'NWBuildStringAdapter', AddToDate: 'NWCalculateDateAdapter', Calc: 'SPMathAdapter', QuerySPList: 'NWQueryListAdapter',
  CollectionOperation: 'NWCollectionAdapter', EndWorkflow: 'WFTerminateAdapter', PauseForActivity: 'NWDelayForAdapter', DelayUntil: 'SPDelayUntilAdapter',
  LoopCondition: 'NWLoopAdapter', ForEach: 'NWForEachLoopAdapter', LoopNTimes: 'NWLoopNTimesAdapter', RegEx: 'NWRegularExpressionAdapter',
  CallHTTPWebService: 'NWWebRequestAdapter', WaitForFieldChange: 'SPWaitForWithKeyAdapter', ConvertValue: 'NWParseValueAdapter',
  CheckOutItem: 'SPCheckOutItemWithKeyAdapter', CheckInItemActivity: 'NWCheckInItemWithKeyAdapter', StartExtendableWorkflow: 'NWStartWorkflow2Adapter',
  ExtractSubstringFromIndex: 'NWModifyStringAdapter', ExtractSubstringFromStart: 'NWModifyStringAdapter', ExtractSubstringFromIndexLength: 'NWModifyStringAdapter',
  ReplaceString: 'NWModifyStringAdapter', Trim: 'NWModifyStringAdapter',
}

/** Classes that are add-on services or not available offline: kept as placeholders with their name. */
const CUSTOM = /^(NintexLive|XtensionsCustomAction|UnavailableAction|DrawloopActivity|AdobeEsignActivity|Filter)$/

function cls(a: XmlNode): string {
  const raw = textOf(child(child(child(a, 'Configuration'), 'ServerInfo'), 'ClassName') ?? child(a, 'ClassName') ?? { name: '', attrs: {}, children: [], text: '' }).trim()
  return raw.split(',')[0].split('.').pop()!.replace(/^#/, '').replace(/\]+$/, '')
}

/** Value element → Nintex reference text ({0} templates filled from FormatValues). */
export function nwpValue(v: XmlNode | undefined): string {
  if (!v) return ''
  for (const c of v.children) {
    const n = local(c.name)
    if (n === 'Variable') return `{WorkflowVariable:${textOf(child(c, 'Name') ?? c).trim()}}`
    if (n === 'ListLookup') {
      const list = textOf(child(c, 'SelectList') ?? c).trim(), field = textOf(child(c, 'SelectField') ?? c).trim()
      return /\[Current Item\]/i.test(list) ? `{ItemProperty:${field}}` : `{Lookup:${field}}`
    }
    if (n === 'WorkflowContext') return `{Common:${textOf(child(c, 'Value') ?? c).trim()}}`
    if (n === 'PrimitiveValue') {
      const raw = child(c, 'Value')
      let text = raw ? (child(raw, 'string') ? textOf(child(raw, 'string')!) : textOf(raw)) : ''
      const formats = children(c, 'FormatValues').map((f) => nwpValue(child(f, 'SelectedValue')))
      formats.forEach((f, i) => { text = text.split(`{${i}}`).join(f) })
      return text
    }
    if (n === 'Collection') return children(c, 'SelectedValue').map((s) => nwpValue(s)).filter(Boolean).join('; ')
    if (n === 'user' || n === 'User') return textOf(c).trim()
  }
  return textOf(v).trim()
}

function dict(v: XmlNode | undefined): Map<string, XmlNode> {
  const d = child(v, 'Dictionary')
  return new Map(children(d, 'DictionaryValue').map((e) => [textOf(child(e, 'Key') ?? e).trim(), child(e, 'Value')!]))
}

const OPS: Record<string, string> = { NotIsEmpty: 'NotIsEmpty', Equal: 'Equal', NotEqual: 'NotEqual', GreaterThan: 'GreaterThan', LessThan: 'LessThan', GreaterThanOrEqual: 'GreaterThanOrEqual', LessThanOrEqual: 'LessThanOrEqual', Contains: 'Contains', IsEmpty: 'IsEmpty', IsNotEmpty: 'NotIsEmpty', StartsWith: 'StartsWith', EndsWith: 'EndsWith' }

/** Longest first: GreaterThanOrEqualInt32 is GreaterThanOrEqual, not GreaterThan. */
const OP_KEYS = Object.keys(OPS).sort((a, b) => b.length - a.length)

function condition(props: Array<{ name: string; value: XmlNode | undefined }>): NintexCondition | null {
  const rules: NintexRule[] = []
  let logic: 'and' | 'or' = 'and'
  let exact = true
  for (const p of props) {
    const d = dict(p.value)
    if (!d.size || !d.has('condition')) continue
    const raw = nwpValue(d.get('condition'))
    const op = OP_KEYS.find((k) => raw.startsWith(k))
    const l = nwpValue(d.get('logic'))
    if (/^or$/i.test(l)) logic = 'or'
    if (!op) { exact = false; continue }
    rules.push({ left: nwpValue(d.get('left')), op: OPS[op], right: nwpValue(d.get('right')) })
  }
  // Older packages: the comparison as plain Left / operator / Right parameters.
  const plain = new Map(props.map((p) => [p.name.toLowerCase(), p.value]))
  if (!rules.length && plain.has('operator')) {
    const raw = nwpValue(plain.get('operator'))
    const op = OP_KEYS.find((k) => raw.startsWith(k))
    if (op) rules.push({ left: nwpValue(plain.get('left')), op: OPS[op], right: nwpValue(plain.get('right')) })
    else exact = false
  }
  if (!rules.length && exact) return null
  return { logic, rules, exact: exact && rules.length > 0, text: rules.map((r) => `${r.left} ${r.op} ${r.right}`).join(` ${logic} `) || 'condition' }
}

function readAction(a: XmlNode, states: Map<string, string>): NintexAction | null {
  const k = cls(a)
  if (!k || k === 'RootActivity' || k === 'SequenceActivity') return null
  const cfg = child(a, 'Configuration')
  const label = textOf(child(cfg, 'Name') ?? { name: '', attrs: {}, children: [], text: '' }).trim()
  const props = children(child(cfg, 'Properties'), 'Property').flatMap((p) => children(p, 'Parameters')).map((p) => ({ name: textOf(child(p, 'Name') ?? p).trim(), value: child(p, 'Value') }))
  const params: Record<string, string> = {}
  const vars: Record<string, string> = {}
  for (const p of props) {
    if (!p.name || child(p.value, 'Dictionary')) continue
    params[p.name] = nwpValue(p.value)
    const v = child(p.value, 'Variable')
    if (v) vars[p.name] = textOf(child(v, 'Name') ?? v).trim()
  }
  const type = CUSTOM.test(k) ? k : (CLASS_MAP[k] ?? k)
  const out: NintexAction = { type, source: k, label: label || k, params, vars, branches: [], enabled: textOf(child(cfg, 'Disabled') ?? { name: '', attrs: {}, children: [], text: '' }).trim() !== 'true' }
  if (CUSTOM.test(k) || !CLASS_MAP[k]) out.custom = CUSTOM.test(k) ? `Nintex for Office 365 ${k}` : undefined
  const kids = children(child(a, 'Children'), 'WorkflowAction')
  for (const kid of kids) {
    const name = textOf(child(child(kid, 'Configuration'), 'Name') ?? { name: '', attrs: {}, children: [], text: '' }).trim()
    const id = textOf(child(kid, 'Id') ?? { name: '', attrs: {}, children: [], text: '' }).trim()
    if (cls(kid) === 'SequenceActivity') {
      if (id) states.set(id, name)
      out.branches.push({ label: name || `Branch ${out.branches.length + 1}`, value: name, id, actions: sequence(kid, states) })
    } else {
      const inner = sequence(kid, states, true)
      if (inner.length) out.branches.push({ label: 'Body', actions: inner })
    }
  }
  // Conditions (Run if, Conditional branch, Loop) are dictionaries; the first branch is "yes".
  if (/^(ConditionalBranch|RunIf|LoopCondition)$/.test(k)) out.condition = condition(props)
  if (k === 'SetMultiVariablesActivity' || k === 'Assign') {
    const assignments: Array<{ name: string; value: string }> = []
    let target = ''
    for (const p of props) {
      if (p.name === 'To') target = textOf(child(child(p.value, 'Variable'), 'Name') ?? { name: '', attrs: {}, children: [], text: '' }).trim()
      else if (p.name === 'Value' && target) { assignments.push({ name: target, value: nwpValue(p.value) }); target = '' }
    }
    out.assignments = assignments
  }
  if (k === 'SendNotificationActivity' || k === 'Email') {
    out.message = { to: split(params.AssignedTo ?? params.To), cc: split(params.CC), subject: params.Subject ?? '', body: params.Body ?? '' }
  }
  if (k === 'SingleTask' || k === 'CompositeTask') {
    out.assignees = split(params.AssignedTo)
    out.outcomes = out.branches.map((b) => b.label)
    out.message = { to: out.assignees, cc: [], subject: params.Title ?? '', body: params.Body ?? '' }
    out.params.TaskName = params.Title ?? ''
    out.params.TaskDescription = params.Body ?? ''
    const behaviours: string[] = []
    if (/true/i.test(params.SendReminderEmail ?? '')) behaviours.push('reminders')
    if (params.EscalationType && !/^none$/i.test(params.EscalationType)) behaviours.push(`escalation (${params.EscalationType})`)
    if (/true/i.test(params.AllowLazyApproval ?? '')) behaviours.push('lazy approval (reply by e-mail)')
    if (k === 'CompositeTask') behaviours.push(`several assignees (${params.CompletionCriteria || 'completion criteria'})`)
    out.behaviours = behaviours
  }
  if (k === 'UpdateListItem' || k === 'CreateListItem') {
    const d = dict(props.find((p) => p.name === 'ListItemProperties')?.value)
    out.fields = [...d.entries()].map(([name, v]) => ({ name, value: nwpValue(v) }))
    const list = params.ListId ?? ''
    out.params.ThisItem = /\{ItemProperty:/.test(list) || /\[Current Item\]/.test(list) || list === '' ? 'true' : 'false'
    const ll = child(props.find((p) => p.name === 'ListId')?.value, 'ListLookup')
    if (ll) out.params.ThisItem = /\[Current Item\]/i.test(textOf(child(ll, 'SelectList') ?? ll)) ? 'true' : 'false'
  }
  if (k === 'SetField') out.fields = [{ name: params.FieldName?.replace(/^\{(ItemProperty|Lookup):|\}$/g, '') ?? '', value: params.FieldValue ?? '' }]
  if (k === 'StringBuilder') { out.params.Input = params.InputString ?? ''; if (vars.OutputString) out.vars!.Output = vars.OutputString }
  if (k === 'WriteToHistory') out.params.Message = params.Message ?? ''
  if (k === 'AddToDate') { out.params.Date = params.Input ?? ''; if (vars.Result) out.vars!.Output = vars.Result }
  if (k === 'Calc') { out.params.Operand1 = params.LValue ?? ''; out.params.Operand2 = params.RValue ?? ''; if (vars.To) out.vars!.VariableName = vars.To }
  if (k === 'QuerySPList') { out.params.Query = params.Caml || params.ODataFilter || ''; out.params.ItemLimitLookup = params.ODataTop ?? '' }
  if (k === 'CollectionOperation') { out.params.Operation = params.InputOperation ?? ''; if (vars.InputCollection) out.vars!.Target = vars.InputCollection; if (vars.OutputCollection) out.vars!.Output = vars.OutputCollection; out.params.Index = params.InputIndex ?? '' }
  if (k === 'RegEx') { out.params.Text = params.InputText ?? ''; out.params.Mode = params.Operation ?? ''; out.params.Replace = params.ReplacementText ?? ''; if (vars.OutTextList) out.vars!.Output = vars.OutTextList }
  if (k === 'Switch') {
    out.params.SwitchVariable = params.switchVariableInput ?? ''
    out.branches = out.branches.map((b) => (/^other$/i.test(b.label) ? { ...b, value: '' } : b))
  }
  if (k === 'StateMachine') out.stateVar = `state_${(textOf(child(a, 'Id') ?? { name: '', attrs: {}, children: [], text: '' }).trim() || 'machine').replace(/[^a-z0-9]/gi, '').slice(0, 8)}`
  if (k === 'SetNextState') out.params.State = params.nextStateId ?? ''
  return out
}

function split(s: string | undefined): string[] {
  return String(s ?? '').split(/[;,]\s*/).map((x) => x.trim()).filter(Boolean)
}

/** A sequence: the action, then its Next chain (and, for a #SequenceActivity, its children in order). */
function sequence(node: XmlNode, states: Map<string, string>, includeSelf = false): NintexAction[] {
  const out: NintexAction[] = []
  if ((cls(node) === 'SequenceActivity' && !includeSelf) || cls(node) === 'RootActivity') {
    for (const kid of children(child(node, 'Children'), 'WorkflowAction')) out.push(...sequence(kid, states, true))
    return out
  }
  let cur: XmlNode | undefined = node
  while (cur) {
    if (cls(cur) === 'SequenceActivity' || cls(cur) === 'RootActivity') {
      for (const kid of children(child(cur, 'Children'), 'WorkflowAction')) out.push(...sequence(kid, states, true))
    } else {
      const a = readAction(cur, states)
      if (a) out.push(a)
    }
    cur = child(cur, 'Next')
  }
  return out
}

function settingsOf(xml: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!xml) return out
  for (const k of ['Title', 'Description', 'StartManually', 'StartOnCreate', 'StartOnChange', 'StartOnCreateConditionEnabled', 'StartOnChangeConditionEnabled']) {
    const m = xml.match(new RegExp(`<${k}>([^<]*)</${k}>`))
    if (m) out[k] = m[1]
  }
  return out
}

/** The files of a .nwp package (zip entries already unpacked) → a workflow. */
export function parseNwpEntries(entries: Array<{ name: string; bytes: Uint8Array }>, fileName = 'workflow.nwp'): NintexWorkflow {
  const get = (re: RegExp) => entries.find((e) => re.test(e.name.replace(/\\/g, '/')))
  const actions = get(/(^|\/)Workflow\/Actions\.xml$/i)
  if (!actions) throw new NintexFormatError(`${fileName}: not a Nintex for Office 365 package (no Workflow/Actions.xml)`)
  const settings = settingsOf(get(/(^|\/)Workflow\/Settings\.xml$/i) ? decodeText(get(/(^|\/)Workflow\/Settings\.xml$/i)!.bytes) : null)
  const varsXml = get(/(^|\/)Workflow\/Variables\.xml$/i)
  const variables: NintexWorkflow['variables'] = []
  if (varsXml) {
    const doc = parseXml(decodeText(varsXml.bytes).replace(/^\s*<\?xml[^>]*\?>/, ''))
    const root = doc.children.find((c) => !c.name.startsWith('?'))
    for (const v of children(root, 'Variable')) {
      const name = textOf(child(v, 'Name') ?? v).trim()
      if (name) variables.push(nwpVariable(v, name))
    }
  }
  const wf = fromActionsXml(decodeText(actions.bytes), settings, variables, fileName)
  const lists = get(/(^|\/)Lists\.xml$/i)
  if (lists) {
    try {
      const info = nwpLists(decodeText(lists.bytes))
      const known = new Map((wf.fields ?? []).map((f) => [f.name.toLowerCase(), f]))
      for (const f of info.fields) {
        const hit = known.get(f.name.toLowerCase())
        if (hit) { hit.display = hit.display ?? f.display; hit.type = hit.type ?? f.type } else known.set(f.name.toLowerCase(), f)
      }
      wf.fields = [...known.values()]
      wf.listIds = info.ids
      if (!wf.listName && info.title) wf.listName = info.title
      for (const l of wf.lookups ?? []) if (l.list && info.ids.some((id) => id.toLowerCase() === l.list!.toLowerCase())) l.current = true
    } catch { /* Lists.xml is optional */ }
  }
  return wf
}

function nwpVariable(v: XmlNode, name: string): NintexVariable {
  const get = (k: string) => { const c = child(v, k); return c ? textOf(c).trim() : '' }
  const out: NintexVariable = { name, type: get('Type') || 'String' }
  if (/^true$/i.test(get('Initiate'))) {
    out.startForm = true
    if (/^true$/i.test(get('Required'))) out.required = true
    if (get('Description')) out.description = get('Description')
    if (get('DefaultValue')) out.defaultValue = get('DefaultValue')
  }
  return out
}

/** Lists.xml: the workflow's own list (IsCurrentList): its id, title and columns. */
export function nwpLists(xml: string): { ids: string[]; title: string | null; fields: NintexFieldInfo[] } {
  const doc = parseXml(xml.replace(/^\s*<\?xml[^>]*\?>/, ''))
  const root = doc.children.find((c) => !c.name.startsWith('?'))
  const infos = children(root, 'ListInfo')
  const text = (n: XmlNode | undefined, k: string) => { const c = child(n, k); return c ? textOf(c).trim() : '' }
  const current = infos.find((l) => /^true$/i.test(text(l, 'IsCurrentList')))
  if (!current) return { ids: [], title: null, fields: [] }
  const fields = children(child(current, 'Fields'), 'FieldInfo').map((f) => ({ name: text(f, 'InternalName'), display: text(f, 'Title') || null, type: text(f, 'TypeAsString') || text(f, 'OutputType') || null })).filter((f) => f.name)
  const id = text(current, 'ListId').replace(/[{}]/g, '')
  return { ids: [id, text(current, 'Title')].filter(Boolean), title: text(current, 'Title') || null, fields }
}

/** [Current Item] lookups (field + type) and lookups to items of other lists, from Actions.xml. */
function nwpFieldRefs(top: XmlNode): { fields: NintexFieldInfo[]; lookups: NonNullable<NintexWorkflow['lookups']> } {
  const fields = new Map<string, NintexFieldInfo>()
  const lookups: NonNullable<NintexWorkflow['lookups']> = []
  const walk = (n: XmlNode) => {
    if (local(n.name) === 'ListLookup') {
      const t = (k: string) => { const c = child(n, k); return c ? textOf(c).trim() : '' }
      const list = t('SelectList'), field = t('SelectField'), type = t('SelectFieldType')
      if (field && /\[Current Item\]/i.test(list)) {
        const hit = fields.get(field.toLowerCase())
        if (!hit) fields.set(field.toLowerCase(), { name: field, type: type || null })
        else if (!hit.type && type) hit.type = type
      } else if (field) lookups.push({ list: list.replace(/[{}]/g, '') || null, field })
    }
    for (const c of n.children) walk(c)
  }
  walk(top)
  return { fields: [...fields.values()], lookups }
}

function fromActionsXml(xml: string, settings: Record<string, string>, variables: NintexWorkflow['variables'], fileName: string): NintexWorkflow {
  let doc: XmlNode
  try { doc = parseXml(xml.replace(/^\s*<\?xml[^>]*\?>/, '')) } catch (error) { throw new NintexFormatError(`${fileName}: Actions.xml is not readable XML: ${error instanceof Error ? error.message : String(error)}`) }
  const root = doc.children.find((c) => !c.name.startsWith('?'))
  if (!root) throw new NintexFormatError(`${fileName}: empty Actions.xml`)
  // ImportExportContainer (gzip form): Workflow/Actions holds the root action.
  const top = local(root.name) === 'WorkflowAction' ? root : (root.children.flatMap((c) => [c, ...c.children]).find((c) => local(c.name) === 'Actions' || local(c.name) === 'WorkflowAction') ?? root)
  const states = new Map<string, string>()
  const acts = sequence(top, states, true)
  // Change state names the state's sequence id: make it the state's name.
  const fix = (list: NintexAction[]) => { for (const a of list) { if (a.type === 'NWStateChangeAdapter' && states.has(a.params.State)) a.params.State = states.get(a.params.State)!; for (const b of a.branches) fix(b.actions) } }
  fix(acts)
  // The state machine's own variable: Change state actions inside it set it.
  const bind = (list: NintexAction[], sm: string | undefined) => { for (const a of list) { const next = a.type === 'NWStateMachine2Adapter' ? a.stateVar : sm; if (a.type === 'NWStateChangeAdapter') a.stateVar = sm; for (const b of a.branches) bind(b.actions, next) } }
  bind(acts, undefined)
  const yes = (k: string) => /^true$/i.test(settings[k] ?? '')
  return {
    name: settings.Title || fileName.replace(/\.nwp$/i, ''), description: settings.Description || null, listName: null, format: 'nwp', workflowType: 'List',
    startManually: settings.StartManually === undefined ? true : yes('StartManually'), startOnCreate: yes('StartOnCreate'), startOnChange: yes('StartOnChange'),
    startConditions: yes('StartOnCreateConditionEnabled') || yes('StartOnChangeConditionEnabled'),
    variables, actions: acts, warnings: [], ...nwpFieldRefs(top),
  }
}

/** A .nwp file's bytes: a zip package, or a gzip of one ImportExportContainer XML. */
export function parseNwpBytes(bytes: Uint8Array, fileName: string, unzip: (b: Uint8Array) => Array<{ name: string; bytes: Uint8Array }>): NintexWorkflow {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const xml = decodeText(new Uint8Array(gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 })))
    const title = xml.match(/<Title>([^<]*)<\/Title>/)?.[1]
    return fromActionsXml(xml, title ? { Title: title } : {}, [], fileName)
  }
  return parseNwpEntries(unzip(bytes), fileName)
}

/** The forms in a .nwp package (Nintex Forms XML / JSON): names and kinds only, for the report. */
export function nwpForms(entries: Array<{ name: string; bytes: Uint8Array }>): Array<{ name: string; kind: string }> {
  return entries.filter((e) => /(^|\/)Forms\/[^/]+\.(xml|json)$/i.test(e.name.replace(/\\/g, '/'))).map((e) => ({ name: e.name.replace(/\\/g, '/').split('/').pop()!, kind: /\.json$/i.test(e.name) ? 'Nintex Forms (responsive, JSON)' : 'Nintex Forms (classic, XML)' }))
}
