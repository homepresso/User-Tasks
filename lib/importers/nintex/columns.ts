/**
 * The column check of a Nintex import onto a list (an extension's target
 * with NintexImportHook.columns, e.g. a connected SharePoint list):
 *
 *   refs      the columns the Nintex workflow uses — [Current Item] field
 *             references anywhere (values, messages, conditions), the fields
 *             of Update item / Set field on the current item, and lookups to
 *             another item of the same list — with the type the export
 *             gives them (.nwf ListLookup field types, Set field types,
 *             .nwp Lists.xml) and how they are used
 *   match     each one against the list's real columns: internal name first,
 *             then display name (the export's display name, or the internal
 *             name decoded: `Cost_x0020_Centre` → "Cost Centre", spaces and
 *             punctuation ignored); then the types: compatible, a type
 *             mismatch (a warning: the step may write a value the column
 *             refuses or read it differently), or missing
 *   suggest   for a missing column: a type from the Nintex type, else from
 *             its use (a number variable written to it → Number, compared
 *             with a number → Number, a person → Person, a few literal values
 *             → Choice), limited to the kinds the target can create
 *   rewrite   matched by display name under another internal name: the
 *             workflow's references move to the list's name (columnMap)
 *
 * Start-form variables are not columns: they become start parameters
 * (startParameters) and are listed beside the columns.
 *
 * Pure: the importer, the dialog's analysis and the tests share it.
 */
import type { ImportColumnKind, ImportColumnRequest, ImportTargetColumn, ImportTargetColumns } from '@/lib/extensions/sdk'
import { varName } from './graph'
import type { NintexAction, NintexVariable, NintexWorkflow } from './model'

export type ColumnUsage = 'read' | 'write' | 'condition' | 'lookup'

export interface NintexColumnRef {
  /** As the workflow names it (an internal name, `_x0020_` encoded). */
  name: string
  /** The display name when the export has it. */
  display: string | null
  /** The Nintex / SharePoint type name from the export (Text, Choice, User …), when known. */
  nintexType: string | null
  kind: ImportColumnKind | null
  usages: ColumnUsage[]
  /** Labels of the actions that use it (at most 6). */
  actions: string[]
  /** Values the workflow writes / compares (literals only, at most 20): choice suggestions. */
  values: string[]
  /** Variables written to it (their Nintex types): type suggestions. */
  fromTypes: string[]
}

export type ColumnStatus = 'matched' | 'type_mismatch' | 'missing'

export interface ColumnCheckRow {
  name: string
  display: string
  nintexType: string | null
  usages: ColumnUsage[]
  actions: string[]
  status: ColumnStatus
  /** How it matched: the internal name, or the display name. */
  by?: 'internal' | 'display'
  column?: { key: string; label: string; typeLabel: string; kind: ImportColumnKind; readOnly?: boolean }
  /** Why it is a type mismatch / what to check. */
  note?: string
  /** Missing: what to add (the person can change the type before adding it). */
  suggestion?: ColumnSuggestion
}

export interface ColumnSuggestion extends ImportColumnRequest {
  typeLabel: string
  /** The target can create this kind (else the column must be added by hand). */
  creatable: boolean
}

export interface ColumnCheck {
  title: string
  rows: ColumnCheckRow[]
  counts: { matched: number; type_mismatch: number; missing: number }
  /** Workflow name → the list's internal name (matched by display name under another name). */
  columnMap: Record<string, string>
  canCreate: boolean
  createReason: string | null
  creatable: ImportColumnKind[]
}

/** Plain labels of the kinds (the target's own label is shown for its columns). */
export const COLUMN_KIND_LABEL: Record<ImportColumnKind, string> = {
  text: 'Single line of text', note: 'Multiple lines of text', number: 'Number', currency: 'Currency', integer: 'Integer',
  datetime: 'Date and time', boolean: 'Yes/No', choice: 'Choice', multichoice: 'Choice (multiple)', person: 'Person or group',
  people: 'Person or group (multiple)', lookup: 'Lookup', lookupmulti: 'Lookup (multiple)', url: 'Hyperlink',
  calculated: 'Calculated', system: 'System', other: 'Other',
}

/** Nintex / SharePoint type names (export field types, variable types) → kinds. */
export function nintexKind(type: string | null | undefined): ImportColumnKind | null {
  const t = String(type ?? '').trim().toLowerCase()
  if (!t) return null
  const map: Record<string, ImportColumnKind> = {
    text: 'text', string: 'text', singleline: 'text', note: 'note', multipleline: 'note', multilinetext: 'note',
    choice: 'choice', choicedropdown: 'choice', multichoice: 'multichoice',
    user: 'person', usermulti: 'people', person: 'person',
    boolean: 'boolean', yesno: 'boolean', bool: 'boolean',
    number: 'number', double: 'number', decimal: 'number', integer: 'integer', int: 'integer', long: 'integer',
    currency: 'currency', datetime: 'datetime', dateonly: 'datetime', date: 'datetime',
    lookup: 'lookup', lookupmulti: 'lookupmulti', url: 'url', hyperlink: 'url',
    computed: 'calculated', calculated: 'calculated',
    counter: 'system', workflowstatus: 'system', file: 'system', attachments: 'system', guid: 'system', contenttypeid: 'system', modstat: 'system',
    taxonomyfieldtype: 'other', taxonomyfieldtypemulti: 'other',
  }
  return map[t] ?? null
}

/** `Cost_x0020_Centre` → "Cost Centre" (SharePoint's internal name encoding). */
export function decodeInternalName(name: string): string {
  return String(name ?? '').replace(/_x([0-9a-f]{4})_/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

const loose = (s: string) => decodeInternalName(s).toLowerCase().replace(/[^a-z0-9]/g, '')

/** References the token mapping treats itself (never a column check). */
const SPECIAL = /^(ID|EncodedAbsUrl|ServerUrl|ItemUrl)$/i

const ITEM_REF = /\{ItemProperty:([^}]+)\}/g

/** The columns the workflow uses (see the header). */
export function collectColumnRefs(wf: NintexWorkflow, options: { aliases?: string[] } = {}): NintexColumnRef[] {
  const catalogue = new Map((wf.fields ?? []).map((f) => [f.name.toLowerCase(), f]))
  const byName = new Map<string, NintexColumnRef>()
  const variables = new Map(wf.variables.map((v) => [v.name, v.type]))
  const ref = (raw: string): NintexColumnRef | null => {
    const name = raw.trim().replace(/\s+/g, '_x0020_')
    if (!name || SPECIAL.test(name)) return null
    const key = name.toLowerCase()
    let r = byName.get(key)
    if (!r) {
      const info = catalogue.get(key)
      r = { name, display: info?.display ?? null, nintexType: info?.type ?? null, kind: nintexKind(info?.type), usages: [], actions: [], values: [], fromTypes: [] }
      byName.set(key, r)
    }
    return r
  }
  const use = (r: NintexColumnRef | null, usage: ColumnUsage, a: NintexAction | null) => {
    if (!r) return
    if (!r.usages.includes(usage)) r.usages.push(usage)
    if (a && a.label && !r.actions.includes(a.label) && r.actions.length < 6) r.actions.push(a.label)
  }
  const literal = (r: NintexColumnRef, value: string) => {
    const v = String(value ?? '').trim()
    if (!v) return
    const variable = /^\{WorkflowVariable:([^}]+)\}$/.exec(v)
    if (variable) { const t = variables.get(variable[1]); if (t && !r.fromTypes.includes(t)) r.fromTypes.push(t); return }
    if (/\{[A-Za-z]+:/.test(v) || v.length > 80) return
    if (!r.values.includes(v) && r.values.length < 20) r.values.push(v)
  }
  const scan = (text: string | undefined, usage: ColumnUsage, a: NintexAction) => {
    for (const m of String(text ?? '').matchAll(ITEM_REF)) use(ref(m[1]), usage, a)
  }
  const walk = (list: NintexAction[]) => {
    for (const a of list) {
      if (a.enabled === false) continue
      const current = a.params.ThisItem === undefined || /true/i.test(a.params.ThisItem)
      const setField = a.type === 'SPSetFieldWithKeyAdapter'
      const writes = (setField || a.type === 'SPUpdateItemWithKeyAdapter') && (setField || current)
      for (const [k, v] of Object.entries(a.params)) {
        if (writes && /^(LookupField|LookupFieldValue|LookupFieldType)$/i.test(k)) continue
        scan(v, 'read', a)
      }
      for (const x of a.assignments ?? []) scan(x.value, 'read', a)
      if (a.message) for (const x of [...a.message.to, ...a.message.cc, a.message.subject, a.message.body]) scan(x, 'read', a)
      for (const x of a.assignees ?? []) scan(x, 'read', a)
      for (const rule of a.condition?.rules ?? []) {
        for (const [side, other] of [[rule.left, rule.right], [rule.right, rule.left]] as const) {
          for (const m of String(side).matchAll(ITEM_REF)) { const r = ref(m[1]); use(r, 'condition', a); if (r) literal(r, other) }
        }
      }
      if (writes) {
        const fields = a.fields?.length ? a.fields : setField ? [{ name: a.params.LookupField ?? a.params.Field ?? '', value: a.params.LookupFieldValue ?? a.params.Value ?? '' }] : []
        for (const f of fields) {
          const r = ref(f.name)
          use(r, 'write', a)
          if (!r) continue
          if (setField && a.params.LookupFieldType && !r.nintexType) { r.nintexType = a.params.LookupFieldType; r.kind = nintexKind(r.nintexType) }
          literal(r, f.value)
          scan(f.value, 'read', a)
        }
      } else for (const f of a.fields ?? []) scan(f.value, 'read', a)
      for (const b of a.branches) walk(b.actions)
    }
  }
  walk(wf.actions)
  // Lookups to an item of the same list read its columns too.
  const own = new Set([...(wf.listIds ?? []), ...(options.aliases ?? []), wf.listName ?? ''].map((x) => String(x).replace(/[{}]/g, '').trim().toLowerCase()).filter(Boolean))
  for (const l of wf.lookups ?? []) {
    if (l.current || (l.list && own.has(l.list.replace(/[{}]/g, '').trim().toLowerCase()))) use(ref(l.field), 'lookup', null)
  }
  return [...byName.values()]
}

const GROUP: Partial<Record<ImportColumnKind, string>> = {
  text: 'text', note: 'text', number: 'number', currency: 'number', integer: 'number', datetime: 'date', boolean: 'boolean',
  choice: 'choice', multichoice: 'choice', person: 'person', people: 'person', lookup: 'lookup', lookupmulti: 'lookup', url: 'url',
}

/** Is a column of kind `have` right for a reference typed `want` used as `usages`? null: compatible; else why not. */
export function typeProblem(want: ImportColumnKind | null, have: ImportTargetColumn, usages: ColumnUsage[]): string | null {
  const writes = usages.includes('write')
  if (writes && (have.readOnly || have.kind === 'calculated' || have.kind === 'system')) return `the workflow writes it, but "${have.label}" is read-only (${have.typeLabel})`
  if (!want || want === have.kind || want === 'other' || have.kind === 'other') return null
  if ((want === 'calculated' || want === 'system') && !writes) return null
  const a = GROUP[want], b = GROUP[have.kind]
  if (a && a === b) {
    if (want === 'note' && have.kind === 'text' && writes) return 'Nintex wrote multiple lines of text; the column holds one line (255 characters)'
    if ((want === 'multichoice' || want === 'people' || want === 'lookupmulti') && have.kind !== want) return `Nintex used several values; the column holds one (${have.typeLabel})`
    if ((have.kind === 'multichoice' || have.kind === 'people' || have.kind === 'lookupmulti') && have.kind !== want) return `Nintex used one value; the column holds several (${have.typeLabel}): check the steps`
    return null
  }
  // A choice column read as text, or text compared with choice values, works as text.
  if ((want === 'text' && have.kind === 'choice') || (want === 'choice' && have.kind === 'text' && !writes)) return null
  return `Nintex used ${COLUMN_KIND_LABEL[want].toLowerCase()}; the column is ${have.typeLabel.toLowerCase()}`
}

/** A valid internal name for a new column (letters, digits, _; ≤ 32). */
export function suggestedKey(name: string): string {
  if (/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name)) return name
  const plain = decodeInternalName(name).replace(/[^A-Za-z0-9]/g, '')
  const key = /^[A-Za-z]/.test(plain) ? plain : `Col${plain}`
  return key.slice(0, 32) || 'Column'
}

/** What to add for a missing column, within the kinds the target can create. */
export function suggestColumn(r: NintexColumnRef, creatable: ImportColumnKind[]): ColumnSuggestion {
  const can = new Set(creatable)
  let kind: ImportColumnKind = r.kind ?? 'text'
  if (!r.kind) {
    const fromVar = r.fromTypes.map(nintexKind).find((k): k is ImportColumnKind => Boolean(k))
    if (fromVar) kind = fromVar
    else if (r.values.length && r.values.every((v) => /^-?\d+(\.\d+)?$/.test(v))) kind = 'number'
    else if (r.values.length && r.values.every((v) => /^(true|false|yes|no)$/i.test(v))) kind = 'boolean'
    else if (r.values.length >= 2 && r.values.length <= 12 && r.values.every((v) => v.length <= 40)) kind = 'choice'
  }
  // The nearest kind the target can make.
  const fallback: Partial<Record<ImportColumnKind, ImportColumnKind[]>> = {
    integer: ['number'], currency: ['number'], people: ['person', 'text'], person: ['text'], multichoice: ['choice', 'text'], choice: ['text'],
    lookup: ['text'], lookupmulti: ['text'], calculated: ['text'], system: ['text'], other: ['text'], note: ['text'], url: ['text'],
  }
  let creatableKind = can.has(kind)
  if (!creatableKind) {
    const next = (fallback[kind] ?? []).find((k) => can.has(k))
    if (next) { kind = next; creatableKind = true }
  }
  const choices = kind === 'choice' || kind === 'multichoice' ? r.values.slice(0, 50) : undefined
  if ((kind === 'choice' || kind === 'multichoice') && !choices?.length && can.has('text')) kind = 'text'
  const label = (r.display ?? decodeInternalName(r.name)).trim().slice(0, 255) || r.name
  return {
    key: suggestedKey(r.name), label, kind, typeLabel: COLUMN_KIND_LABEL[kind], creatable: creatableKind && can.has(kind),
    ...(choices?.length && (kind === 'choice' || kind === 'multichoice') ? { choices } : {}),
    description: `Added for the Nintex workflow (used by ${r.actions.slice(0, 3).join(', ') || 'its steps'})`.slice(0, 255),
  }
}

/** Match the workflow's columns against the target's (see the header). */
export function checkColumns(refs: NintexColumnRef[], target: ImportTargetColumns): ColumnCheck {
  const byKey = new Map<string, ImportTargetColumn>()
  const byLabel = new Map<string, ImportTargetColumn>()
  const byLoose = new Map<string, ImportTargetColumn>()
  for (const c of target.columns) {
    if (!byKey.has(c.key.toLowerCase())) byKey.set(c.key.toLowerCase(), c)
    if (!byLabel.has(c.label.trim().toLowerCase())) byLabel.set(c.label.trim().toLowerCase(), c)
    for (const k of [loose(c.label), loose(c.key)]) if (k && !byLoose.has(k)) byLoose.set(k, c)
  }
  const creatable = target.creatable ?? []
  const columnMap: Record<string, string> = {}
  const rows: ColumnCheckRow[] = refs.map((r) => {
    const display = (r.display ?? decodeInternalName(r.name)).trim()
    let column = byKey.get(r.name.toLowerCase()) ?? byKey.get(decodeInternalName(r.name).toLowerCase())
    let by: ColumnCheckRow['by'] = 'internal'
    if (!column) {
      by = 'display'
      column = byLabel.get(display.toLowerCase()) ?? byLabel.get(decodeInternalName(r.name).trim().toLowerCase()) ?? byLoose.get(loose(display)) ?? byLoose.get(loose(r.name))
    }
    const base = { name: r.name, display, nintexType: r.nintexType, usages: r.usages, actions: r.actions }
    if (!column) return { ...base, status: 'missing' as const, suggestion: suggestColumn(r, creatable) }
    if (column.key !== r.name) columnMap[r.name] = column.key
    // No type in the export: the type of the variables written to it.
    const problem = typeProblem(r.kind ?? r.fromTypes.map(nintexKind).find((k): k is ImportColumnKind => Boolean(k)) ?? null, column, r.usages)
    const col = { key: column.key, label: column.label, typeLabel: column.typeLabel, kind: column.kind, ...(column.readOnly ? { readOnly: true } : {}) }
    return { ...base, status: problem ? 'type_mismatch' as const : 'matched' as const, by, column: col, ...(problem ? { note: problem } : by === 'display' ? { note: `matched by its display name: the steps use ${column.key}` } : {}) }
  })
  const order: Record<ColumnStatus, number> = { missing: 0, type_mismatch: 1, matched: 2 }
  rows.sort((a, b) => order[a.status] - order[b.status] || a.display.localeCompare(b.display))
  return {
    title: target.title,
    rows,
    counts: { matched: rows.filter((r) => r.status === 'matched').length, type_mismatch: rows.filter((r) => r.status === 'type_mismatch').length, missing: rows.filter((r) => r.status === 'missing').length },
    columnMap,
    canCreate: target.canCreate === true && creatable.length > 0,
    createReason: target.canCreate === true ? (creatable.length ? null : 'This list does not support adding columns from UserTasks') : (target.createReason ?? null),
    creatable,
  }
}

/* ── start form → start parameters ── */

export interface StartParameter {
  name: string
  label: string
  type: 'string' | 'number' | 'boolean'
  format?: 'date' | 'datetime' | 'select'
  required?: boolean
  options?: string[]
  defaultValue?: string
  description: string
}

/** The Nintex start form's variables as workflow start parameters (the Run dialog / start page asks for them). */
export function startParameters(variables: NintexVariable[]): StartParameter[] {
  return variables.filter((v) => v.startForm).map((v) => {
    const kind = nintexKind(v.control) ?? nintexKind(v.type)
    const type: StartParameter['type'] = kind === 'number' || kind === 'integer' || kind === 'currency' ? 'number' : kind === 'boolean' ? 'boolean' : 'string'
    const choices = (v.choices ?? []).filter(Boolean)
    const format: StartParameter['format'] | undefined = choices.length ? 'select' : kind === 'datetime' ? (/dateonly/i.test(v.control ?? '') ? 'date' : 'datetime') : undefined
    return {
      name: varName(v.name), label: v.name, type,
      ...(format ? { format } : {}),
      ...(v.required ? { required: true } : {}),
      ...(choices.length ? { options: choices } : {}),
      ...(v.defaultValue ? { defaultValue: v.defaultValue } : {}),
      description: (v.description || `Nintex start form: "${v.name}"${kind === 'person' || kind === 'people' ? ' (a person: their e-mail address)' : ''}`).slice(0, 300),
    }
  })
}

/* ── flags in the workflow ── */

/** The `{{after.X}}` / `"X":` references of a step's settings to a column name. */
export function nodeUsesColumn(config: unknown, name: string): boolean {
  const json = JSON.stringify(config ?? {})
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\{\\{\\s*after\\.${esc}\\s*\\}\\}|\\\\?"${esc}\\\\?"\\s*:`).test(json)
}

/** Mark the steps that use columns the list does not have (config._import_review): the designer flags them. */
export function flagMissingColumns(nodes: Array<{ config: Record<string, unknown> }>, rows: ColumnCheckRow[], listTitle: string): number {
  let flagged = 0
  const missing = rows.filter((r) => r.status === 'missing')
  if (!missing.length) return 0
  for (const n of nodes) {
    const notes = missing.filter((r) => nodeUsesColumn(n.config, r.name)).map((r) => `Column "${r.display}" (${r.name}) is not on "${listTitle}": add it to the list, or change this step`)
    if (!notes.length) continue
    const prev = Array.isArray(n.config._import_review) ? (n.config._import_review as unknown[]).map(String) : []
    n.config = { ...n.config, _import_review: [...new Set([...prev, ...notes])].slice(0, 20) }
    flagged += 1
  }
  return flagged
}

/* ── a new list for the workflow ── */

/** What a new list can usually hold (the extension refuses kinds it cannot create). */
export const DEFAULT_CREATABLE: ImportColumnKind[] = ['text', 'note', 'number', 'currency', 'datetime', 'boolean', 'choice', 'multichoice', 'person', 'url']

/** Columns every list has (never proposed for a new list). */
const BUILT_IN = /^(Title|Created|Modified|Author|Editor|ID|FileLeafRef|FileRef|FileDirRef|ContentType|Attachments|_UIVersionString|_ModerationStatus|_ModerationComments|CheckoutUser|LinkFilename|LinkTitle)$/i

export interface NeededColumn extends ColumnSuggestion { required: boolean; source: 'column' | 'start_form'; note?: string }

/**
 * The columns a new list for this workflow needs: every column the workflow uses (not the
 * built-in ones), typed from the export or its use, then the start form's fields. Lookups become
 * text with a note (the list they point to is not known).
 */
export function columnsNeeded(wf: NintexWorkflow, creatable: ImportColumnKind[] = DEFAULT_CREATABLE): NeededColumn[] {
  const out: NeededColumn[] = []
  const keys = new Set<string>()
  for (const r of collectColumnRefs(wf)) {
    if (BUILT_IN.test(r.name)) continue
    const s = suggestColumn(r, creatable)
    if (keys.has(s.key.toLowerCase())) continue
    keys.add(s.key.toLowerCase())
    const wasLookup = r.kind === 'lookup' || r.kind === 'lookupmulti' || r.usages.includes('lookup') && !r.kind
    out.push({ ...s, required: false, source: 'column', ...(wasLookup && s.kind === 'text' ? { note: 'A lookup in Nintex: created as text (add the lookup by hand to point it at its list)' } : r.kind === 'calculated' ? { note: 'Calculated in Nintex: created as text' } : {}) })
  }
  for (const p of startParameters(wf.variables)) {
    const key = suggestedKey(p.label.replace(/\s+/g, ''))
    if (keys.has(key.toLowerCase())) continue
    keys.add(key.toLowerCase())
    const kind: ImportColumnKind = p.options?.length ? 'choice' : p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : p.format === 'date' || p.format === 'datetime' ? 'datetime' : 'text'
    out.push({ key, label: p.label, kind, typeLabel: COLUMN_KIND_LABEL[kind], creatable: creatable.includes(kind), required: Boolean(p.required), source: 'start_form', ...(p.options?.length ? { choices: p.options } : {}), description: 'Nintex start form field' })
  }
  return out
}

/** Document actions or file references: a document library suits it better than a list. */
export function usesDocuments(wf: NintexWorkflow): boolean {
  const doc = /^(SPCheckOutItemWithKeyAdapter|NWCheckInItemWithKeyAdapter|SPWaitForDocumentStatusAdapter|NWDocGenAdapter|NWCopyToSharepointSite2Adapter|NWCopyToFolderAdapter)$/
  let found = false
  const walk = (list: NintexAction[]) => { for (const a of list) { if (doc.test(a.type) || Object.values(a.params).some((v) => /\{ItemProperty:(FileLeafRef|FileRef|EncodedAbsUrl)\}/i.test(v))) found = true; for (const b of a.branches) walk(b.actions) } }
  walk(wf.actions)
  return found
}
