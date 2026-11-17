/**
 * SharePoint CAML queries → a neutral filter (conditions with and / or,
 * order, row limit) and an OData $filter / $orderby for SharePoint REST.
 * Used by importers (Nintex Query list, SharePoint Designer lookups).
 *
 *   Eq Neq Lt Gt Leq Geq Contains BeginsWith IsNull IsNotNull, And / Or (nested),
 *   OrderBy (FieldRef Ascending), RowLimit, ViewFields
 *
 * Anything else (In, DateRangesOverlap, Membership, lookup ids, user fields,
 * <Today/> offsets …) marks the result inexact and is listed in
 * `unsupported`: callers keep the raw CAML next to the translation and ask
 * for review.
 */
import { local, parseXml, textOf, type XmlNode } from './nintex/xml'

export type CamlOp = 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge' | 'contains' | 'starts_with' | 'is_empty' | 'is_not_empty'
export interface CamlRule { field: string; op: CamlOp; value: string; type: string }
export interface CamlGroup { logic: 'and' | 'or'; items: Array<CamlRule | CamlGroup> }
export interface CamlQuery {
  where: CamlGroup | null
  orderBy: Array<{ field: string; ascending: boolean }>
  rowLimit: number | null
  viewFields: string[]
  /** The list named by the query (Nintex wraps <Lists><List ID=…/>). */
  listId: string | null
  exact: boolean
  unsupported: string[]
}

const OPS: Record<string, CamlOp> = { Eq: 'eq', Neq: 'ne', Lt: 'lt', Gt: 'gt', Leq: 'le', Geq: 'ge', Contains: 'contains', BeginsWith: 'starts_with', IsNull: 'is_empty', IsNotNull: 'is_not_empty' }

function kids(n: XmlNode, name?: string): XmlNode[] {
  return n.children.filter((c) => !name || local(c.name) === name)
}

export function parseCaml(raw: string, valueOf: (text: string) => string = (s) => s): CamlQuery {
  const out: CamlQuery = { where: null, orderBy: [], rowLimit: null, viewFields: [], listId: null, exact: true, unsupported: [] }
  let doc: XmlNode
  try { doc = parseXml(`<Root>${String(raw ?? '').replace(/^\s*<\?xml[^>]*\?>/, '')}</Root>`) } catch { return { ...out, exact: false, unsupported: ['unreadable CAML'] } }
  const root = doc.children[0]
  const find = (n: XmlNode, name: string): XmlNode | undefined => {
    for (const c of n.children) { if (local(c.name) === name) return c; const d = find(c, name); if (d) return d }
    return undefined
  }
  const list = find(root, 'List')
  if (list?.attrs.ID) out.listId = list.attrs.ID.replace(/[{}]/g, '').toLowerCase()
  const vf = find(root, 'ViewFields')
  if (vf) out.viewFields = kids(vf, 'FieldRef').map((f) => f.attrs.Name).filter(Boolean)
  const rl = find(root, 'RowLimit')
  if (rl && Number(textOf(rl).trim()) > 0) out.rowLimit = Number(textOf(rl).trim())
  const ob = find(root, 'OrderBy')
  if (ob) out.orderBy = kids(ob, 'FieldRef').map((f) => ({ field: f.attrs.Name, ascending: !/^false$/i.test(f.attrs.Ascending ?? 'true') })).filter((f) => f.field)
  const where = find(root, 'Where')
  const cond = (n: XmlNode): CamlRule | CamlGroup | null => {
    const name = local(n.name)
    if (name === 'And' || name === 'Or') {
      const items = kids(n).map(cond).filter((x): x is CamlRule | CamlGroup => Boolean(x))
      return { logic: name === 'And' ? 'and' : 'or', items }
    }
    const op = OPS[name]
    if (!op) { out.exact = false; out.unsupported.push(name); return null }
    const ref = kids(n, 'FieldRef')[0]
    const val = kids(n, 'Value')[0]
    if (!ref?.attrs.Name) { out.exact = false; out.unsupported.push(`${name} without a field`); return null }
    if (ref.attrs.LookupId === 'TRUE') { out.exact = false; out.unsupported.push(`${name} on a lookup id (${ref.attrs.Name})`) }
    const type = val?.attrs.Type ?? 'Text'
    if (val && val.children.length) { out.exact = false; out.unsupported.push(`<${val.children.map((c) => local(c.name)).join(', ')}/> in a value`) }
    if (/^User$/i.test(type)) { out.exact = false; out.unsupported.push(`${name} on a person field (${ref.attrs.Name})`) }
    return { field: ref.attrs.Name, op, value: val ? valueOf(textOf(val).trim()) : '', type }
  }
  if (where) {
    const top = kids(where).map(cond).filter((x): x is CamlRule | CamlGroup => Boolean(x))
    out.where = top.length === 1 && 'logic' in top[0] ? top[0] as CamlGroup : { logic: 'and', items: top }
  }
  return out
}

function odataValue(r: CamlRule): string {
  if (/^(Number|Integer|Counter|Currency)$/i.test(r.type) && /^-?\d+(\.\d+)?$/.test(r.value)) return r.value
  if (/^Boolean$/i.test(r.type)) return /^(1|true|yes)$/i.test(r.value) ? '1' : '0'
  if (/^DateTime$/i.test(r.type)) return `datetime'${r.value.replace(/'/g, "''")}'`
  return `'${r.value.replace(/'/g, "''")}'`
}

/** OData $filter (SharePoint REST v3 functions: substringof, startswith). */
export function camlToODataFilter(group: CamlGroup | null): string {
  if (!group) return ''
  const one = (x: CamlRule | CamlGroup): string => {
    if ('logic' in x) { const parts = x.items.map(one).filter(Boolean); return parts.length > 1 ? `(${parts.join(` ${x.logic} `)})` : parts[0] ?? '' }
    switch (x.op) {
      case 'contains': return `substringof(${odataValue({ ...x, type: 'Text' })},${x.field})`
      case 'starts_with': return `startswith(${x.field},${odataValue({ ...x, type: 'Text' })})`
      case 'is_empty': return `${x.field} eq null`
      case 'is_not_empty': return `${x.field} ne null`
      default: return `${x.field} ${x.op} ${odataValue(x)}`
    }
  }
  const s = one(group)
  return s.startsWith('(') && s.endsWith(')') && group.items.length > 1 ? s.slice(1, -1) : s
}

export function camlToODataOrderBy(orderBy: CamlQuery['orderBy']): string {
  return orderBy.map((o) => `${o.field}${o.ascending ? '' : ' desc'}`).join(',')
}

/** A short readable form of the filter (report notes, placeholders). */
export function camlToText(group: CamlGroup | null): string {
  if (!group) return 'all items'
  const sym: Record<CamlOp, string> = { eq: '=', ne: '≠', lt: '<', gt: '>', le: '≤', ge: '≥', contains: 'contains', starts_with: 'starts with', is_empty: 'is empty', is_not_empty: 'is not empty' }
  const one = (x: CamlRule | CamlGroup): string => ('logic' in x ? `(${x.items.map(one).join(` ${x.logic} `)})` : `${x.field} ${sym[x.op]}${/empty/.test(x.op) ? '' : ` ${x.value}`}`)
  return one(group).replace(/^\((.*)\)$/, '$1')
}
