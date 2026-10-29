/**
 * A small, safe XML reader for the document actions (OOXML / ODF parts,
 * XML files a workflow reads).
 *
 * Safe by construction: it never resolves entities beyond the five
 * predefined ones and numeric character references, and it refuses any
 * document with a DOCTYPE (where external entities — XXE — and entity
 * expansion bombs live; OOXML and ODF parts never have one). Element depth
 * and node count are bounded, and the parser is iterative (no recursion on
 * input).
 */

export interface XmlElement {
  /** Qualified name as written (`w:p`). */
  name: string
  /** Name without the namespace prefix (`p`). */
  local: string
  attrs: Record<string, string>
  children: XmlChild[]
}

export type XmlChild = XmlElement | string

export class XmlSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmlSecurityError'
  }
}

export interface ParseXmlOptions {
  maxDepth?: number
  maxNodes?: number
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ''
      return String.fromCodePoint(code)
    }
    return ENTITIES[body] ?? whole
  })
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex -- strip characters XML 1.0 cannot hold
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

/** Parse an XML document into its root element. Throws on DOCTYPE / malformed input. */
export function parseXml(input: string, options: ParseXmlOptions = {}): XmlElement {
  const maxDepth = options.maxDepth ?? 512
  const maxNodes = options.maxNodes ?? 5_000_000
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const root: XmlElement = { name: '#document', local: '#document', attrs: {}, children: [] }
  const stack: XmlElement[] = [root]
  let nodes = 0
  let i = 0
  const len = text.length

  while (i < len) {
    const lt = text.indexOf('<', i)
    if (lt === -1) {
      pushText(text.slice(i))
      break
    }
    if (lt > i) pushText(text.slice(i, lt))
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      if (end === -1) throw new Error('Malformed XML: unterminated comment')
      i = end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9)
      if (end === -1) throw new Error('Malformed XML: unterminated CDATA')
      appendText(text.slice(lt + 9, end))
      i = end + 3
      continue
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2)
      if (end === -1) throw new Error('Malformed XML: unterminated processing instruction')
      i = end + 2
      continue
    }
    if (text.startsWith('<!', lt)) {
      // DOCTYPE, ENTITY, ELEMENT …: refused outright (XXE / entity expansion).
      throw new XmlSecurityError('XML with a DOCTYPE or entity declarations is not accepted')
    }
    const gt = findTagEnd(text, lt + 1)
    if (gt === -1) throw new Error('Malformed XML: unterminated tag')
    const raw = text.slice(lt + 1, gt)
    i = gt + 1
    if (raw[0] === '/') {
      const name = raw.slice(1).trim()
      const top = stack[stack.length - 1]
      if (stack.length === 1 || top.name !== name) throw new Error(`Malformed XML: unexpected </${name.slice(0, 40)}>`)
      stack.pop()
      continue
    }
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const nameEnd = body.search(/[\s]/)
    const name = nameEnd === -1 ? body : body.slice(0, nameEnd)
    if (!name) throw new Error('Malformed XML: empty tag name')
    const attrs: Record<string, string> = {}
    if (nameEnd !== -1) {
      ATTR_RE.lastIndex = 0
      const attrText = body.slice(nameEnd)
      let m: RegExpExecArray | null
      while ((m = ATTR_RE.exec(attrText))) attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? '')
    }
    const el: XmlElement = { name, local: localName(name), attrs, children: [] }
    if (++nodes > maxNodes) throw new XmlSecurityError('XML has too many elements')
    stack[stack.length - 1].children.push(el)
    if (!selfClosing) {
      if (stack.length > maxDepth) throw new XmlSecurityError('XML is nested too deeply')
      stack.push(el)
    }
  }
  if (stack.length > 1) throw new Error(`Malformed XML: <${stack[stack.length - 1].name.slice(0, 40)}> is not closed`)
  const first = root.children.find((c): c is XmlElement => typeof c !== 'string')
  if (!first) throw new Error('Malformed XML: no root element')
  return first

  function appendText(value: string) {
    const parent = stack[stack.length - 1]
    if (parent === root) return
    const last = parent.children[parent.children.length - 1]
    if (typeof last === 'string') parent.children[parent.children.length - 1] = last + value
    else parent.children.push(value)
  }
  function pushText(raw: string) {
    if (stack.length === 1) return // whitespace / junk outside the root
    appendText(decodeXmlEntities(raw))
  }
}

/** Index of the `>` closing a tag that starts at `from`, skipping quoted attribute values. */
function findTagEnd(text: string, from: number): number {
  let quote = ''
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return i
  }
  return -1
}

/* ── Navigation helpers ─────────────────────────────────────────────── */

export function elements(node: XmlElement): XmlElement[] {
  return node.children.filter((c): c is XmlElement => typeof c !== 'string')
}

export function childrenByLocal(node: XmlElement, local: string): XmlElement[] {
  return elements(node).filter((c) => c.local === local)
}

export function child(node: XmlElement | undefined, local: string): XmlElement | undefined {
  if (!node) return undefined
  return elements(node).find((c) => c.local === local)
}

/** Every descendant element with this local name (document order, iterative). */
export function descendants(node: XmlElement, local: string): XmlElement[] {
  const out: XmlElement[] = []
  const stack: XmlElement[] = [...elements(node)].reverse()
  while (stack.length) {
    const el = stack.pop()!
    if (el.local === local) out.push(el)
    const kids = elements(el)
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k])
  }
  return out
}

/** Attribute by qualified or local name (`w:val` or `val`). */
export function attr(node: XmlElement | undefined, name: string): string | undefined {
  if (!node) return undefined
  if (name in node.attrs) return node.attrs[name]
  for (const [key, value] of Object.entries(node.attrs)) if (localName(key) === name) return value
  return undefined
}

/** All text below a node. */
export function textOf(node: XmlChild): string {
  if (typeof node === 'string') return node
  let out = ''
  const stack: XmlChild[] = [node]
  while (stack.length) {
    const cur = stack.pop()!
    if (typeof cur === 'string') {
      out += cur
      continue
    }
    for (let k = cur.children.length - 1; k >= 0; k--) stack.push(cur.children[k])
  }
  return out
}

/** Element → plain JS value (for XML files a workflow reads): attributes as `@name`, text as `#text`. */
export function xmlToJson(node: XmlElement): unknown {
  const kids = elements(node)
  const text = node.children.filter((c): c is string => typeof c === 'string').join('').trim()
  const attrKeys = Object.keys(node.attrs)
  if (kids.length === 0 && attrKeys.length === 0) return text
  const out: Record<string, unknown> = {}
  for (const key of attrKeys) out[`@${key}`] = node.attrs[key]
  for (const kid of kids) {
    const value = xmlToJson(kid)
    if (kid.name in out) {
      const existing = out[kid.name]
      out[kid.name] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else out[kid.name] = value
  }
  if (text) out['#text'] = text
  return out
}

/** Element → XML text (with the standard declaration). Comments and processing instructions are not kept. */
export function serializeXml(root: XmlElement): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n']
  const stack: Array<XmlChild | { close: string }> = [root]
  while (stack.length) {
    const cur = stack.pop()!
    if (typeof cur === 'string') { out.push(escapeXml(cur)); continue }
    if ('close' in cur) { out.push(`</${cur.close}>`); continue }
    const attrs = Object.entries(cur.attrs).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('')
    if (!cur.children.length) { out.push(`<${cur.name}${attrs}/>`); continue }
    out.push(`<${cur.name}${attrs}>`)
    stack.push({ close: cur.name })
    for (let k = cur.children.length - 1; k >= 0; k--) stack.push(cur.children[k])
  }
  return out.join('')
}
