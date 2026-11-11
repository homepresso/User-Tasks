/**
 * InfoPath's main data source schema (myschema.xsd, plus the XSDs it
 * imports) → a tree of nodes with absolute local-name paths
 * (`/expenseReport/items/item/amount`).
 *
 * InfoPath writes every element globally (`<xsd:element name="amount" type="xsd:decimal"/>`)
 * and references them (`<xsd:element ref="my:amount" minOccurs="0"/>`), so
 * refs are resolved by name; anonymous and named complex / simple types,
 * sequences, choices, alls, attributes and attribute refs are followed.
 *
 *   type        from the xsd base type (my:requiredString / my:requiredAnyURI etc. are
 *               InfoPath's "cannot be blank" string types)
 *   repeating   maxOccurs > 1 / unbounded
 *   required    a non-nillable non-string leaf (dates, numbers, booleans must be
 *               nillable to be left blank), minLength ≥ 1, or the required* types
 *   rich text   a mixed complex type holding xhtml (xsd:any namespace xhtml)
 *   attachment  base64Binary
 */

import { attr, elements, type XmlElement } from '@/lib/documents/xml'
import { localOf } from './xpath'
import type { IpDataType, IpSchemaNode } from './model'

const XSD_TYPES: Record<string, IpDataType> = {
  string: 'string', normalizedstring: 'string', token: 'string', language: 'string', name: 'string', ncname: 'string', id: 'string', qname: 'string',
  boolean: 'boolean', date: 'date', datetime: 'dateTime', time: 'time',
  integer: 'integer', int: 'integer', long: 'integer', short: 'integer', byte: 'integer', nonnegativeinteger: 'integer', positiveinteger: 'integer',
  nonpositiveinteger: 'integer', negativeinteger: 'integer', unsignedint: 'integer', unsignedlong: 'integer', unsignedshort: 'integer', unsignedbyte: 'integer',
  decimal: 'decimal', double: 'double', float: 'double', anyuri: 'anyURI', base64binary: 'base64Binary', hexbinary: 'base64Binary',
  gyear: 'string', gyearmonth: 'string', duration: 'string',
}

interface Facets { pattern?: string; enumeration?: string[]; minLength?: number; maxLength?: number; minInclusive?: number; maxInclusive?: number; minExclusive?: number; maxExclusive?: number }

interface Defs {
  elements: Map<string, XmlElement>
  complexTypes: Map<string, XmlElement>
  simpleTypes: Map<string, XmlElement>
  attributes: Map<string, XmlElement>
  groups: Map<string, XmlElement>
}

const MAX_NODES = 5000
const MAX_DEPTH = 40

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Collect the global definitions of every schema document. */
function collect(schemas: XmlElement[]): Defs {
  const defs: Defs = { elements: new Map(), complexTypes: new Map(), simpleTypes: new Map(), attributes: new Map(), groups: new Map() }
  for (const schema of schemas) {
    for (const el of elements(schema)) {
      const name = attr(el, 'name')
      if (!name) continue
      const key = localOf(name)
      if (el.local === 'element' && !defs.elements.has(key)) defs.elements.set(key, el)
      else if (el.local === 'complexType' && !defs.complexTypes.has(key)) defs.complexTypes.set(key, el)
      else if (el.local === 'simpleType' && !defs.simpleTypes.has(key)) defs.simpleTypes.set(key, el)
      else if (el.local === 'attribute' && !defs.attributes.has(key)) defs.attributes.set(key, el)
      else if (el.local === 'group' && !defs.groups.has(key)) defs.groups.set(key, el)
    }
  }
  return defs
}

/** A simple type's base and facets (named or anonymous; restrictions chained). */
function simpleType(typeName: string | undefined, inline: XmlElement | undefined, defs: Defs, depth = 0): { base: IpDataType; facets: Facets; requiredType: boolean } {
  const facets: Facets = {}
  let requiredType = false
  if (depth > 10) return { base: 'string', facets, requiredType }
  let st = inline
  if (!st && typeName) {
    const local = localOf(typeName)
    const builtin = XSD_TYPES[local.toLowerCase()]
    const prefix = typeName.includes(':') ? typeName.slice(0, typeName.indexOf(':')) : ''
    if (builtin && (!defs.simpleTypes.has(local) || /^xsd?$/i.test(prefix))) return { base: builtin, facets, requiredType }
    if (/^required/i.test(local)) requiredType = true
    st = defs.simpleTypes.get(local)
    if (!st) return { base: builtin ?? 'string', facets, requiredType }
  }
  if (!st) return { base: 'string', facets, requiredType }
  const restriction = elements(st).find((e) => e.local === 'restriction')
  const union = elements(st).find((e) => e.local === 'union')
  if (union) {
    // InfoPath's "number or blank" types: <xsd:union memberTypes="xsd:double my:empty"/>.
    const members = (attr(union, 'memberTypes') ?? '').split(/\s+/).filter(Boolean)
    for (const m of members) {
      const t = simpleType(m, undefined, defs, depth + 1)
      if (t.base !== 'string') return { base: t.base, facets, requiredType }
    }
    return { base: 'string', facets, requiredType }
  }
  if (!restriction) return { base: 'string', facets, requiredType }
  const inner = elements(restriction).find((e) => e.local === 'simpleType')
  const base = simpleType(attr(restriction, 'base'), inner, defs, depth + 1)
  Object.assign(facets, base.facets)
  requiredType = requiredType || base.requiredType
  for (const f of elements(restriction)) {
    const v = attr(f, 'value')
    if (v === undefined) continue
    switch (f.local) {
      case 'pattern': facets.pattern = facets.pattern ? `${facets.pattern}` : v; break
      case 'enumeration': (facets.enumeration ??= []).push(v); break
      case 'minLength': facets.minLength = num(v); break
      case 'maxLength': facets.maxLength = num(v); break
      case 'length': facets.minLength = num(v); facets.maxLength = num(v); break
      case 'minInclusive': facets.minInclusive = num(v); break
      case 'maxInclusive': facets.maxInclusive = num(v); break
      case 'minExclusive': facets.minExclusive = num(v); break
      case 'maxExclusive': facets.maxExclusive = num(v); break
    }
  }
  if ((facets.minLength ?? 0) >= 1) requiredType = true
  return { base: base.base, facets, requiredType }
}

/** Parse the main schema (and siblings it imports / includes) into the data tree. */
export function parseSchema(schemaDocs: XmlElement[], rootName?: string | null): { root: IpSchemaNode | null; warnings: string[] } {
  const warnings: string[] = []
  const defs = collect(schemaDocs)
  let count = 0
  const rootEl = (rootName && defs.elements.get(localOf(rootName))) || pickRoot(defs)
  if (!rootEl) return { root: null, warnings: ['The schema has no root element'] }

  const build = (el: XmlElement, parentPath: string, occurs: { min: number; max: number }, depth: number, seen: Set<string>): IpSchemaNode | null => {
    if (++count > MAX_NODES) { if (count === MAX_NODES + 1) warnings.push(`The schema has more than ${MAX_NODES} nodes: the rest is skipped`); return null }
    let def = el
    const ref = attr(el, 'ref')
    if (ref) {
      const target = defs.elements.get(localOf(ref))
      if (!target) { warnings.push(`Schema reference ${ref} is not defined`); return null }
      def = target
    }
    const name = localOf(attr(def, 'name') ?? attr(el, 'ref') ?? '')
    if (!name) return null
    const path = `${parentPath}/${name}`
    const node: IpSchemaNode = { name, path, type: 'string', repeating: occurs.max > 1, required: false, children: [] }
    if (seen.has(name) || depth > MAX_DEPTH) {
      warnings.push(`The schema nests ${name} inside itself: it is read once`)
      node.type = 'group'
      return node
    }
    const typeName = attr(def, 'type')
    const inlineComplex = elements(def).find((e) => e.local === 'complexType')
    const inlineSimple = elements(def).find((e) => e.local === 'simpleType')
    const complex = inlineComplex ?? (typeName ? defs.complexTypes.get(localOf(typeName)) : undefined)
    const nillable = attr(def, 'nillable') === 'true'
    const fixed = attr(def, 'fixed')
    const dflt = attr(def, 'default') ?? fixed
    if (dflt !== undefined) node.default = dflt
    if (complex) {
      const mixed = attr(complex, 'mixed') === 'true'
      const anys = descendantsLocal(complex, 'any')
      if (mixed && anys.some((a) => /xhtml/i.test(attr(a, 'namespace') ?? ''))) {
        node.type = 'xhtml'
        return node
      }
      // simpleContent: a leaf with attributes.
      const simpleContent = elements(complex).find((e) => e.local === 'simpleContent')
      if (simpleContent) {
        const ext = elements(simpleContent)[0]
        const t = simpleType(attr(ext, 'base'), undefined, defs)
        node.type = t.base
        applyFacets(node, t.facets)
      } else {
        node.type = 'group'
        const nextSeen = new Set(seen).add(name)
        walkParticles(complex, path, depth, nextSeen, node)
      }
      for (const a of attributesOf(complex, defs)) node.children.push(attributeNode(a, path, defs))
      return node
    }
    const t = simpleType(typeName, inlineSimple, defs)
    node.type = t.base
    applyFacets(node, t.facets)
    node.nillable = nillable
    // Not nillable and not text: InfoPath can't leave it blank → required. Text needs minLength / a required* type.
    // (InfoPath writes every reference with minOccurs="0"; "cannot be blank" on a date / number is the missing nillable.)
    node.required = t.requiredType || (!nillable && !['string', 'anyURI', 'xhtml', 'base64Binary'].includes(t.base))
    return node
  }

  const walkParticles = (container: XmlElement, path: string, depth: number, seen: Set<string>, node: IpSchemaNode) => {
    for (const p of elements(container)) {
      if (p.local === 'element') {
        const min = num(attr(p, 'minOccurs')) ?? 1
        const maxRaw = attr(p, 'maxOccurs')
        const max = maxRaw === 'unbounded' ? Infinity : num(maxRaw) ?? 1
        const childNode = build(p, path, { min, max }, depth + 1, seen)
        if (childNode) node.children.push(childNode)
      } else if (['sequence', 'choice', 'all', 'complexContent', 'extension', 'restriction'].includes(p.local)) {
        const maxRaw = attr(p, 'maxOccurs')
        if (p.local !== 'sequence' && p.local !== 'all' && p.local === 'choice' && (maxRaw === 'unbounded' || (num(maxRaw) ?? 1) > 1)) {
          warnings.push(`A repeating choice under ${path} is read as plain fields`)
        }
        if (p.local === 'extension' || p.local === 'restriction') {
          const base = attr(p, 'base')
          const baseType = base ? defs.complexTypes.get(localOf(base)) : undefined
          if (baseType) walkParticles(baseType, path, depth, seen, node)
        }
        walkParticles(p, path, depth, seen, node)
      } else if (p.local === 'group') {
        const ref = attr(p, 'ref')
        const g = ref ? defs.groups.get(localOf(ref)) : undefined
        if (g) walkParticles(g, path, depth, seen, node)
      }
    }
  }

  const root = build(rootEl, '', { min: 1, max: 1 }, 0, new Set())
  return { root, warnings }
}

function applyFacets(node: IpSchemaNode, f: Facets) {
  if (f.pattern) node.pattern = f.pattern
  if (f.enumeration?.length) node.enumeration = f.enumeration
  if (f.minLength !== undefined) node.minLength = f.minLength
  if (f.maxLength !== undefined) node.maxLength = f.maxLength
  if (f.minInclusive !== undefined) node.min = f.minInclusive
  if (f.maxInclusive !== undefined) node.max = f.maxInclusive
  if (f.minExclusive !== undefined && node.min === undefined) node.min = f.minExclusive
  if (f.maxExclusive !== undefined && node.max === undefined) node.max = f.maxExclusive
}

function descendantsLocal(node: XmlElement, local: string, depth = 0): XmlElement[] {
  if (depth > 20) return []
  const out: XmlElement[] = []
  for (const c of elements(node)) {
    if (c.local === local) out.push(c)
    out.push(...descendantsLocal(c, local, depth + 1))
  }
  return out
}

function attributesOf(complex: XmlElement, defs: Defs): XmlElement[] {
  const out: XmlElement[] = []
  const walk = (n: XmlElement, depth: number) => {
    if (depth > 6) return
    for (const c of elements(n)) {
      if (c.local === 'attribute') out.push(attr(c, 'ref') ? defs.attributes.get(localOf(attr(c, 'ref')!)) ?? c : c)
      else if (['simpleContent', 'complexContent', 'extension', 'restriction'].includes(c.local)) walk(c, depth + 1)
    }
  }
  walk(complex, 0)
  return out
}

function attributeNode(a: XmlElement, path: string, defs: Defs): IpSchemaNode {
  const name = localOf(attr(a, 'name') ?? attr(a, 'ref') ?? 'attribute')
  const inline = elements(a).find((e) => e.local === 'simpleType')
  const t = simpleType(attr(a, 'type'), inline, defs)
  const node: IpSchemaNode = { name, path: `${path}/@${name}`, type: t.base, repeating: false, required: attr(a, 'use') === 'required' && t.requiredType, children: [], attribute: true }
  applyFacets(node, t.facets)
  const dflt = attr(a, 'default') ?? attr(a, 'fixed')
  if (dflt !== undefined) node.default = dflt
  return node
}

/** The root: a global element no other element references. */
function pickRoot(defs: Defs): XmlElement | null {
  const referenced = new Set<string>()
  const walk = (n: XmlElement, depth: number) => {
    if (depth > 40) return
    for (const c of elements(n)) {
      if (c.local === 'element' && attr(c, 'ref')) referenced.add(localOf(attr(c, 'ref')!))
      walk(c, depth + 1)
    }
  }
  for (const el of defs.elements.values()) walk(el, 0)
  for (const t of defs.complexTypes.values()) walk(t, 0)
  for (const [name, el] of defs.elements) if (!referenced.has(name)) return el
  return defs.elements.values().next().value ?? null
}

/** Every node of the tree, depth first. */
export function schemaNodes(root: IpSchemaNode | null): IpSchemaNode[] {
  const out: IpSchemaNode[] = []
  const walk = (n: IpSchemaNode) => { out.push(n); n.children.forEach(walk) }
  if (root) walk(root)
  return out
}
