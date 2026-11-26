/**
 * Nintex Forms → UserTasks form fields.
 *
 * Two layouts are read:
 *   classic (Nintex Forms 2010 / 2013 / 2016 and Office 365 classic):
 *     a `Form` XML (in a .nwp's Forms/FormN.xml as escaped `FormXml`, or a
 *     list template's form file) with `FormControlProperties` elements typed
 *     by `i:type` (TextBox, Choice, DateTime, PeoplePicker, Label, Panel,
 *     Repeater …): DisplayName / DataFieldDisplayName, Name, IsRequired,
 *     Choices, HelpText.
 *   responsive (New Responsive Designer, .nwp Forms/FormN.json): JSON in
 *     `FormContent` — rows of controls (`widget`: textbox, choice, datetime,
 *     people-picker, list-lookup, multilinetext, group-control …) with
 *     `properties` (title, name, required, items "value|label,…").
 *
 * Layout, rules and styling are not converted: the fields come in order,
 * groups / panels become headings, repeaters a repeating section.
 */
import type { TaskFieldDef, TaskFieldType } from '@/lib/task-field-schema'
import { decodeText, decodeXml, local, parseXml, textOf, type XmlNode } from './xml'
import { varName } from './graph'

export interface NintexFormModel {
  name: string
  kind: 'classic' | 'responsive'
  fields: TaskFieldDef[]
  /** Controls left out (buttons, images, rich text …) and why. */
  skipped: Array<{ control: string; reason: string }>
  rules: number
  /** The workflow task this form belongs to (.nwp), when it is a task form. */
  actionId: string | null
}

const CLASSIC: Record<string, TaskFieldType | 'heading' | null> = {
  TextBox: 'text', MultiLineTextBox: 'textarea', Choice: 'choice', DateTime: 'datetime', PeoplePicker: 'user', Boolean: 'boolean', YesNo: 'boolean',
  Number: 'number', Currency: 'currency', HyperlinkColumn: 'url', Hyperlink: 'url', ListLookup: 'lookup', LookupColumn: 'lookup', Attachment: 'attachments',
  Panel: 'heading', Label: null, Button: null, Image: null, RichText: 'textarea', CalculatedValue: null, Repeater: undefined as never, ManagedMetadata: 'text',
}

const RESPONSIVE: Record<string, TaskFieldType | 'heading' | null> = {
  textbox: 'text', multilinetext: 'textarea', choice: 'choice', 'multi-choice': 'multi_choice', datetime: 'datetime', 'people-picker': 'user', 'list-lookup': 'lookup',
  'yes-no': 'boolean', number: 'number', currency: 'currency', email: 'email', 'file-upload': 'attachments', 'group-control': 'heading', repeater: undefined as never,
  'richtext-label': null, label: null, image: null, actionpanel: null, button: null, signature: 'text', 'url': 'url',
}

function uniqueKey(raw: string, used: Set<string>): string {
  const base = varName(raw || 'field')
  let key = base, n = 2
  while (used.has(key)) key = `${base}_${n++}`
  used.add(key)
  return key
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => local(c.name) === name)
}

function text(node: XmlNode, name: string): string {
  const c = child(node, name)
  return c && c.attrs['i:nil'] !== 'true' ? textOf(c).trim() : ''
}

function classicForm(xml: string, name: string, actionId: string | null): NintexFormModel {
  const doc = parseXml(xml.replace(/^\s*<\?xml[^>]*\?>/, ''))
  const used = new Set<string>()
  const fields: TaskFieldDef[] = []
  const skipped: NintexFormModel['skipped'] = []
  let rules = 0
  const walk = (n: XmlNode) => {
    if (local(n.name) === 'Rule') rules += 1
    if (local(n.name) === 'FormControlProperties') {
      const type = (Object.entries(n.attrs).find(([k]) => local(k) === 'type')?.[1] ?? '').split(':').pop()!.replace(/FormControlProperties$/, '')
      const label = text(n, 'DataFieldDisplayName') || text(n, 'DisplayName') || text(n, 'Name') || type
      const t = Object.hasOwn(CLASSIC, type) ? CLASSIC[type] : undefined
      if (t === undefined || t === null) { skipped.push({ control: `${type}${label && label !== type ? ` "${label}"` : ''}`, reason: t === null ? 'display control' : 'no matching field type' }); return }
      const field: TaskFieldDef = { key: uniqueKey(text(n, 'Name') || label, used), label, type: t as TaskFieldType }
      if (text(n, 'IsRequired') === 'true') field.required = true
      const help = text(n, 'HelpText')
      if (help) field.help_text = help
      const choices = child(n, 'Choices')
      if (choices && (t === 'choice')) field.options = choices.children.map((c) => textOf(c).trim()).filter(Boolean)
      if (t === 'choice' && text(n, 'AllowMultipleValues') === 'true') field.type = 'multi_choice'
      fields.push(field)
    }
    for (const c of n.children) walk(c)
  }
  walk(doc)
  return { name, kind: 'classic', fields, skipped, rules, actionId }
}

const MAX_RESPONSIVE_DEPTH = 200

function responsiveForm(json: string, name: string, actionId: string | null): NintexFormModel {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch (error) {
    throw new Error(`Nintex form ${name}: not valid JSON (${error instanceof RangeError ? 'nested too deeply' : (error as Error).message})`)
  }
  const used = new Set<string>()
  const fields: TaskFieldDef[] = []
  const skipped: NintexFormModel['skipped'] = []
  const rules = Array.isArray(data.ruleGroups) ? (data.ruleGroups as Array<{ rules?: unknown[] }>).reduce((n, g) => n + (Array.isArray(g?.rules) ? g.rules.length : 0), 0) : 0
  // Real forms nest a few levels; a hostile file nested thousands deep would
  // overflow the stack (a RangeError instead of a clean "not a form" error).
  let depth = 0
  const walk = (o: unknown) => {
    if (++depth > MAX_RESPONSIVE_DEPTH) throw new Error(`Nintex form ${name}: nested deeper than ${MAX_RESPONSIVE_DEPTH} levels — not a Nintex Forms export`)
    try {
      walkNode(o)
    } finally {
      depth--
    }
  }
  const walkNode = (o: unknown) => {
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (!o || typeof o !== 'object') return
    const c = o as Record<string, unknown>
    if (typeof c.widget === 'string') {
      const props = (c.properties ?? {}) as Record<string, unknown>
      const label = String(props.title ?? props.name ?? c.widget)
      const t = Object.hasOwn(RESPONSIVE, c.widget) ? RESPONSIVE[c.widget] : undefined
      if (t === undefined || t === null) skipped.push({ control: `${c.widget}${props.title ? ` "${props.title}"` : ''}`, reason: t === null ? 'display control' : 'no matching field type' })
      else {
        const field: TaskFieldDef = { key: uniqueKey(String(props.name ?? label).replace(/^Task__/, ''), used), label, type: t as TaskFieldType }
        if (props.required === true) field.required = true
        if (props.helpText) field.help_text = String(props.helpText)
        if ((t === 'choice' || t === 'multi_choice') && typeof props.items === 'string') {
          const items = String(props.items).split(',').map((x) => x.split('|')).filter((x) => x[0])
          field.options = items.map((x) => x[0])
          const labels = Object.fromEntries(items.filter((x) => x[1] && x[1] !== x[0]).map((x) => [x[0], x[1]]))
          if (Object.keys(labels).length) field.option_labels = labels
        }
        fields.push(field)
      }
      walk(props.rows)
      return
    }
    for (const v of Object.values(c)) walk(v)
  }
  walk(data.rows)
  return { name, kind: 'responsive', fields, skipped, rules, actionId }
}

/**
 * Text of the first `<tag>…</tag>` (null when absent). indexOf, not a lazy
 * regex: `/<T>([\s\S]*?)<\/T>/` re-scans to the end from every `<T>` when
 * the close is missing — quadratic on a file of repeated open tags.
 */
function between(raw: string, tag: string): string | null {
  const open = raw.indexOf(`<${tag}>`)
  if (open === -1) return null
  const start = open + tag.length + 2
  const end = raw.indexOf(`</${tag}>`, start)
  return end === -1 ? null : raw.slice(start, end)
}

/** One Nintex Forms file (a .nwp's Forms/FormN.xml|json, or a bare form XML) → fields. */
export function parseNintexForm(bytes: Uint8Array, fileName: string): NintexFormModel {
  const raw = decodeText(bytes)
  const name = fileName.replace(/\\/g, '/').split('/').pop()!.replace(/\.(xml|json)$/i, '')
  const actionId = between(raw, 'ActionId')?.trim() || null
  const content = between(raw, 'FormContent')
  if (content) return responsiveForm(decodeXml(content), name, actionId)
  const inner = between(raw, 'FormXml')
  if (inner) return classicForm(decodeXml(inner), name, actionId)
  if (/^\s*\{/.test(raw)) return responsiveForm(raw, name, actionId)
  return classicForm(raw, name, actionId)
}
