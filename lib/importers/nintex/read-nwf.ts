/**
 * Nintex for SharePoint 2010 / 2013 / 2016 workflow export (.nwf) reader.
 *
 * The file: `ExportedWorkflowWithListMetdata` (sic) wrapping the serialized
 * `ExportedWorkflow` (escaped XML text) plus list metadata and WorkflowType
 * (List / Site / GloballyReusable). Inside, `Configurations/ActionConfigs`
 * holds one `NWActionConfig` per action, in designer order: `Type` (the
 * adapter class), `TLabel` (its title), `Enabled`, `Parameters/Parameter`
 * (values as PrimitiveValue / Variable / ListLookup / WorkflowConstant /
 * WorkflowContextData), type-specific elements (Message, Approvers,
 * FieldReferences, Condition, Outcomes) and `ChildActivities` for
 * containers. Branches are child actions of their own: WFSequenceAdapter,
 * WFIfElseBranchAdapter, NWApproverBranchAdapter, NWSwitchBranchAdapter,
 * NWState2Adapter. The first action, NWWorkflowVariablesAdapter, holds the
 * workflow settings (start options); variables are in `WorkflowVariables`.
 *
 * Checked against real Nintex 2010 and 2013 / 2016 exports.
 * The older synthetic layout the preview reader was built from
 * (`ActionConfig` with `DisplayName` and attribute values) is still read.
 */
import { decodeXml, local, parseXml, textOf, type XmlNode } from './xml'
import { NintexFormatError, nintexName, type NintexAction, type NintexCondition, type NintexFieldInfo, type NintexRule, type NintexVariable, type NintexWorkflow } from './model'

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => local(c.name) === name)
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => local(c.name) === name) : []
}

function childText(node: XmlNode, ...names: string[]): string | null {
  for (const n of names) {
    const c = child(node, n)
    if (c) return textOf(c).trim()
    if (node.attrs[n] !== undefined) return node.attrs[n]
  }
  return null
}

export function shortType(raw: string): string {
  return raw.split(',')[0].trim().split('.').pop() ?? raw
}

/** The serialized ExportedWorkflow inside the .nwf wrapper (escaped XML text, or inline), and the wrapper. */
function innerWorkflow(doc: XmlNode): { wf: XmlNode; outer: XmlNode | null } {
  const root = doc.children.find((c) => !c.name.startsWith('?'))
  if (!root) throw new NintexFormatError('Empty file')
  if (local(root.name) === 'ExportedWorkflow') return { wf: root, outer: null }
  if (/ExportedWorkflowWithListMet[a]?data/.test(local(root.name))) {
    const ser = child(root, 'ExportedWorkflowSeralized') ?? child(root, 'ExportedWorkflowSerialized')
    const inline = child(root, 'ExportedWorkflow')
    if (inline) return { wf: inline, outer: root }
    if (ser) {
      const text = textOf(ser).trim()
      const xml = text.startsWith('<') ? text : decodeXml(text)
      const inner = parseXml(xml.replace(/^\s*<\?xml[^>]*\?>/, ''))
      const w = inner.children.find((c) => local(c.name) === 'ExportedWorkflow')
      if (w) return { wf: w, outer: root }
    }
  }
  throw new NintexFormatError('Not a Nintex workflow export (.nwf): no ExportedWorkflow element')
}

/* ── values ── */

/** A value element's children → Nintex reference text. */
export function valueOf(node: XmlNode | undefined): string {
  if (!node) return ''
  const v = child(node, 'Variable')
  if (v?.attrs.Name) return `{WorkflowVariable:${v.attrs.Name}}`
  const pv = child(node, 'PrimitiveValue')
  if (pv) return pv.attrs.Value ?? textOf(pv).trim()
  const ll = child(node, 'ListLookup')
  if (ll) {
    const field = child(ll, 'Field')?.attrs.Name ?? ''
    if (ll.attrs.LookupType === 'ThisItemLookup' && field) return `{ItemProperty:${field}}`
    return field ? `{Lookup:${field}}` : '{Lookup:?}'
  }
  const wc = child(node, 'WorkflowConstant')
  if (wc?.attrs.Name) return `{WFConstant:${wc.attrs.Name}}`
  const ctx = child(node, 'WorkflowContextData')
  if (ctx) return `{Common:${ctx.attrs.Name ?? ctx.attrs.Value ?? textOf(ctx).trim()}}`
  if (node.attrs.Value !== undefined && !node.children.length) return node.attrs.Value
  return ''
}

/* ── conditions ── */

function readRule(cfg: XmlNode): { rule: NintexRule | null; text: string } {
  const params = new Map(children(child(cfg, 'Params'), 'Param').map((p) => [p.attrs.Name, p]))
  const op = valueOf(params.get('operator'))
  const left = valueOf(params.get('left')), right = valueOf(params.get('right'))
  const name = cfg.attrs.Name ?? ''
  // The two value comparisons map exactly; other condition kinds (permissions, keywords, dates …) need review.
  if (!/equals value/i.test(name) || !op) return { rule: null, text: name || 'condition' }
  return { rule: { left, op, right }, text: `${left} ${op} ${right}` }
}

export function readCondition(node: XmlNode | undefined): NintexCondition | null {
  const c = child(node, 'Condition')
  if (!c) return null
  const walk = (n: XmlNode): NintexCondition => {
    const type = Object.entries(n.attrs).find(([k]) => local(k) === 'type')?.[1] ?? ''
    if (type === 'ConditionPair') {
      const logic = /or/i.test(n.attrs.Operator ?? '') ? 'or' : 'and'
      const l = walk(child(n, 'Left')!), r = walk(child(n, 'Right')!)
      const same = (x: NintexCondition) => x.rules.length <= 1 || x.logic === logic
      return { logic, rules: [...l.rules, ...r.rules], exact: l.exact && r.exact && same(l) && same(r), text: `(${l.text}) ${logic} (${r.text})` }
    }
    const { rule, text } = readRule(n)
    return { logic: 'and', rules: rule ? [rule] : [], exact: Boolean(rule), text }
  }
  return walk(c)
}

/* ── actions ── */

const BRANCH_TYPES = new Set(['WFSequenceAdapter', 'WFIfElseBranchAdapter', 'NWApproverBranchAdapter', 'NWSwitchBranchAdapter', 'NWState2Adapter'])

function readParams(node: XmlNode): { params: Record<string, string>; vars: Record<string, string> } {
  const params: Record<string, string> = {}
  const vars: Record<string, string> = {}
  for (const p of children(child(node, 'Parameters'), 'Parameter')) {
    const name = p.attrs.Name
    if (!name) continue
    params[name] = valueOf(p)
    const v = child(p, 'Variable')
    if (v?.attrs.Name) vars[name] = v.attrs.Name
  }
  return { params, vars }
}

/** The actions of a branch: a branch adapter's children, sequences flattened. */
function flatten(list: XmlNode[]): NintexAction[] {
  const out: NintexAction[] = []
  for (const n of list) {
    const type = shortType(childText(n, 'Type') ?? '')
    if (type === 'WFSequenceAdapter') out.push(...flatten(children(child(n, 'ChildActivities'), 'NWActionConfig')))
    else { const a = readNw(n); if (a) out.push(a) }
  }
  return out
}

function readNw(node: XmlNode): NintexAction | null {
  const type = shortType(childText(node, 'Type') ?? '')
  if (!type || type === 'NWWorkflowVariablesAdapter') return null
  const label = (childText(node, 'TLabel') || '').trim() || nintexName(type)
  const { params, vars } = readParams(node)
  const assembly = (childText(node, 'Assembly') ?? '').split(',')[0].trim()
  const a: NintexAction = { type, label, params, vars, branches: [], enabled: childText(node, 'Enabled') !== 'false' }
  // Third-party actions (Xtensions, Muhimbi …) and Nintex add-ons that need their own service (Live, Hawkeye).
  if (assembly && assembly !== 'Nintex.Workflow' && !/^Nintex\.Workflow\.UserDefinedActions/.test(assembly)) a.custom = assembly
  a.condition = readCondition(node)
  const kids = children(child(node, 'ChildActivities'), 'NWActionConfig')
  // Branches: each child branch adapter (or sequence) is one branch.
  if (kids.length && kids.every((k) => BRANCH_TYPES.has(shortType(childText(k, 'Type') ?? '')))) {
    kids.forEach((k, i) => {
      const kt = shortType(childText(k, 'Type') ?? '')
      const kp = readParams(k).params
      const inner = kt === 'WFSequenceAdapter' || kt === 'NWState2Adapter' || kt === 'WFIfElseBranchAdapter' || kt === 'NWApproverBranchAdapter' || kt === 'NWSwitchBranchAdapter'
        ? flatten(children(child(k, 'ChildActivities'), 'NWActionConfig')) : []
      // A state's actions sit in its own sequence: NWState2Adapter > WFSequenceAdapter > actions.
      const stateNode = kt === 'WFSequenceAdapter' ? children(child(k, 'ChildActivities'), 'NWActionConfig').find((c) => shortType(childText(c, 'Type') ?? '') === 'NWState2Adapter') : undefined
      if (stateNode) {
        const sp = readParams(stateNode).params
        a.branches.push({ label: sp.State || `State ${i + 1}`, value: sp.State ?? '', actions: flatten(children(child(stateNode, 'ChildActivities'), 'NWActionConfig')) })
      } else {
        a.branches.push({ label: kp.Value ?? kp.State ?? `Branch ${i + 1}`, value: kp.Value ?? kp.State, actions: inner })
      }
      if (kt === 'WFIfElseBranchAdapter' && !a.condition) a.condition = readCondition(k)
    })
  } else if (kids.length) {
    a.branches.push({ label: 'Body', actions: flatten(kids) })
  }
  // Type-specific parts.
  const msg = child(node, 'Message')
  if (msg) {
    a.message = {
      to: children(child(node, 'Approvers'), 'Approver').map(principal).filter(Boolean),
      cc: children(child(msg, 'CcList'), 'Approver').map(principal).filter(Boolean),
      subject: childText(msg, 'Subject') ?? '', body: childText(msg, 'Body') ?? '',
    }
  }
  const approvers = children(child(node, 'Approvers'), 'Approver')
  if (/Approver|MultiOutcome|Review|AssignTodo|CollectData/.test(type)) {
    a.assignees = approvers.map(principal).filter(Boolean)
    const first = approvers.find((x) => child(x, 'ApprovalRequiredMsg')) ?? approvers[0]
    const req = child(first, 'ApprovalRequiredMsg')
    if (req) a.message = { to: a.assignees, cc: [], subject: childText(req, 'Subject') ?? '', body: childText(req, 'Body') ?? '' }
    const outcomes = children(child(node, 'Outcomes'), 'Outcome').map((o) => ({ name: o.attrs.Name ?? '', index: Number(o.attrs.BranchIndex ?? 0) })).filter((o) => o.name)
    if (outcomes.length) {
      a.outcomes = outcomes.sort((x, y) => x.index - y.index).map((o) => o.name)
      a.branches = a.branches.map((b, i) => ({ ...b, label: a.outcomes![i] ?? b.label }))
    }
    const behaviours: string[] = []
    if (params.ApprovalType && params.ApprovalType !== 'FirstToRespond') behaviours.push(`approval type ${params.ApprovalType}`)
    if ((params.RemindersRequired ?? '0') !== '0') behaviours.push('reminders')
    if ((params.EscalationType ?? 'None') !== 'None' && params.EscalationType) behaviours.push(`escalation (${params.EscalationType})`)
    if (approvers.some((x) => x.attrs.AllowDelegation === 'true')) behaviours.push('delegation')
    if (approvers.some((x) => x.attrs.AllowLazyApprove === 'true')) behaviours.push('lazy approval (reply by e-mail)')
    if (/NintexForms/i.test(params.FormUrl ?? '')) behaviours.push('Nintex Forms task form')
    a.behaviours = behaviours
  }
  const refs = children(child(node, 'FieldReferences'), 'FieldReference')
  if (refs.length && /Update|Create|UserDefined/.test(type)) {
    a.fields = refs.map((r) => ({ name: r.attrs.Value || r.attrs.Name || '', value: valueOf(r) }))
  }
  if (refs.length && /Switch|StateMachine/.test(type) && !a.branches.some((b) => b.value)) {
    a.branches = a.branches.map((b, i) => ({ ...b, label: refs[i]?.attrs.Name ?? b.label, value: refs[i]?.attrs.Name }))
  }
  if (type === 'NWStateMachine2Adapter' || type === 'NWStateChangeAdapter') a.stateVar = vars.VariableName ?? params.VariableName
  return a
}

function principal(x: XmlNode): string {
  const user = x.attrs.User ?? ''
  if (user) return user.replace(/^i:0#\.[wf]\|/, '')
  const other = childText(x, 'OtherEmailAddress')
  if (other) return other
  const v = valueOf(x)
  return v
}

/* ── legacy (synthetic preview layout) ── */

function readLegacy(node: XmlNode): NintexAction | null {
  const type = shortType(childText(node, 'Type', 'AdapterType', 'ActivityType', 'TypeName') ?? '')
  if (!type) return null
  const label = childText(node, 'DisplayName', 'Label', 'Title') ?? type
  const params: Record<string, string> = {}
  const paramsNode = child(node, 'Parameters') ?? child(node, 'Configuration')
  for (const p of paramsNode?.children ?? []) {
    const name = p.attrs.Name ?? local(p.name)
    params[name] = p.attrs.Value ?? textOf(p).trim()
  }
  const branches: NintexAction['branches'] = []
  for (const b of node.children.filter((c) => local(c.name) === 'Branch')) {
    branches.push({ label: b.attrs.Name ?? b.attrs.Label ?? `Branch ${branches.length + 1}`, actions: readLegacyList(b) })
  }
  const kids = child(node, 'ChildActivities') ?? child(node, 'ChildActions')
  if (kids && !branches.length) branches.push({ label: 'Body', actions: readLegacyList(kids) })
  return { type, label, params, branches }
}

function readLegacyList(container: XmlNode): NintexAction[] {
  const out: NintexAction[] = []
  for (const c of container.children) {
    if (!/^(ActionConfig|ActivityConfig|Action)$/.test(local(c.name))) continue
    const a = readLegacy(c)
    if (a) out.push(a)
  }
  return out
}

/* ── workflow ── */

export function parseNwf(text: string, fileName = 'workflow.nwf'): NintexWorkflow {
  let doc: XmlNode
  try { doc = parseXml(text.replace(/^﻿/, '')) } catch (error) { throw new NintexFormatError(`${fileName} is not readable XML: ${error instanceof Error ? error.message : String(error)}`) }
  const { wf, outer } = innerWorkflow(doc)
  const configs = child(wf, 'Configurations')
  const actionsNode = (configs && (child(configs, 'ActionConfigs') ?? child(configs, 'ActivityConfigs'))) ?? child(wf, 'ActionConfigs') ?? child(wf, 'Actions')
  if (!actionsNode) throw new NintexFormatError(`${fileName}: no action configurations found (Configurations/ActionConfigs)`)
  const real = children(actionsNode, 'NWActionConfig')
  const variables: NintexWorkflow['variables'] = []
  const varsNode = child(wf, 'WorkflowVariables') ?? (configs && child(configs, 'WorkflowVariables'))
  for (const v of varsNode?.children ?? []) {
    const name = v.attrs.Name ?? childText(v, 'Name')
    if (name) variables.push(nwfVariable(v, name))
  }
  const { fields, lookups } = collectNwfFields(wf)
  if (real.length) {
    const settings = real.find((n) => shortType(childText(n, 'Type') ?? '') === 'NWWorkflowVariablesAdapter')
    const sp = settings ? readParams(settings).params : {}
    const yes = (k: string) => /^true$/i.test(sp[k] ?? '')
    if (!variables.length && settings) {
      for (const v of children(child(settings, 'WorkflowVariables'), 'Variable')) if (v.attrs.Name) variables.push(nwfVariable(v, v.attrs.Name))
    }
    const listName = outer ? (children(child(outer, 'ListReferences'), 'ListReference').map((l) => childText(l, 'ListName')).find(Boolean) ?? null) : null
    return {
      name: childText(wf, 'Title', 'Name') || sp.WorkflowName || fileName.replace(/\.nwf$/i, ''),
      description: childText(wf, 'Description') || null,
      listName, format: 'nwf',
      workflowType: (outer && childText(outer, 'WorkflowType')) || 'List',
      startManually: yes('StartManually'), startOnCreate: yes('StartOnCreate'), startOnChange: yes('StartOnChange'),
      startConditions: yes('StartOnCreateCondition') || yes('StartOnChangeCondition'),
      variables, actions: flatten(real), warnings: [], fields, lookups,
      listIds: [listName, ...(outer ? children(child(outer, 'ListReferences'), 'ListReference').map((l) => childText(l, 'ListId')) : [])].filter((x): x is string => Boolean(x)),
    }
  }
  const start = child(wf, 'StartOptions')
  return {
    name: childText(wf, 'Name', 'WorkflowName') ?? fileName.replace(/\.nwf$/i, ''),
    description: childText(wf, 'Description'),
    listName: childText(wf, 'ListName', 'AssociatedList'), format: 'legacy', workflowType: 'List',
    startManually: true,
    startOnCreate: /true/i.test(start?.attrs.StartOnCreate ?? childText(wf, 'StartOnCreate') ?? ''),
    startOnChange: /true/i.test(start?.attrs.StartOnChange ?? childText(wf, 'StartOnChange') ?? ''),
    startConditions: false,
    variables,
    actions: readLegacyList(actionsNode),
    warnings: [],
    fields,
    lookups,
  }
}

/** A `<Variable …>` of WorkflowVariables (attributes, or child elements in older exports). */
function nwfVariable(v: XmlNode, name: string): NintexVariable {
  const get = (k: string) => v.attrs[k] ?? childText(v, k)
  const out: NintexVariable = { name, type: get('Type') || 'Text' }
  if (/^true$/i.test(get('Initiate') ?? '')) {
    out.startForm = true
    if (/^true$/i.test(get('Required') ?? '')) out.required = true
    const description = get('Description')
    if (description) out.description = description
    const def = get('DefaultValue')
    if (def) out.defaultValue = def
    const control = get('ControlType')
    if (control && control !== 'None') out.control = control
    const choices = children(v, 'Choice').map((c) => (c.attrs.Value ?? textOf(c)).trim()).filter(Boolean)
    if (choices.length) out.choices = choices
  }
  return out
}

/**
 * The list columns the export names with their types: `[Current Item]`
 * lookups (`ListLookup LookupType="ThisItemLookup"` → `Field Name / Type`),
 * set-field actions (`LookupField` + `LookupFieldType`), and the lookups to
 * an item of another list (`CrossItemLookup`, with the list id when written).
 */
function collectNwfFields(wf: XmlNode): { fields: NintexFieldInfo[]; lookups: NonNullable<NintexWorkflow['lookups']> } {
  const fields = new Map<string, NintexFieldInfo>()
  const lookups: NonNullable<NintexWorkflow['lookups']> = []
  const add = (name: string, type: string | null | undefined) => {
    if (!name) return
    const hit = fields.get(name.toLowerCase())
    if (!hit) fields.set(name.toLowerCase(), { name, type: type || null })
    else if (!hit.type && type) hit.type = type
  }
  const walk = (n: XmlNode) => {
    const name = local(n.name)
    if (name === 'ListLookup') {
      const f = child(n, 'Field')
      const field = f?.attrs.Name ?? ''
      if (n.attrs.LookupType === 'ThisItemLookup') add(field, f?.attrs.Type)
      else if (field) lookups.push({ list: (child(n, 'ListId') ? textOf(child(n, 'ListId')!).trim() : null) || null, field })
    } else if (name === 'Parameters') {
      const ps = new Map(children(n, 'Parameter').map((p) => [p.attrs.Name, p]))
      const field = ps.get('LookupField')
      const type = ps.get('LookupFieldType')
      const fieldName = field ? (child(field, 'PrimitiveValue')?.attrs.Value ?? '') : ''
      if (fieldName && !/^\{/.test(fieldName)) add(fieldName, type ? child(type, 'PrimitiveValue')?.attrs.Value : null)
    }
    for (const c of n.children) walk(c)
  }
  walk(wf)
  return { fields: [...fields.values()], lookups }
}
