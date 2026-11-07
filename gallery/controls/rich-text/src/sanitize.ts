/**
 * The rich-text sanitiser: an allowlist rebuild, never a blocklist filter.
 * Input (pasted HTML, a stored value, the editor's own DOM) is parsed into
 * an inert document (DOMParser / <template>: no scripts run, nothing loads)
 * and walked; a brand-new tree is built with createElement / createTextNode
 * holding only
 *
 *   p, br, strong (b), em (i), u, h2, h3, ul, ol, li, blockquote, a
 *
 * and no attributes at all — except `href` on links, kept only for https:,
 * http: and mailto: URLs, plus rel="noopener noreferrer" target="_blank".
 * Every other element is dropped but its text is kept (script, style and
 * other non-content elements are dropped with their text). A few block
 * elements map to the nearest allowed one (div → p, h1 → h2, h4–h6 → h3) so
 * line structure survives a paste. Loose inline content at the top level is
 * wrapped in <p>.
 */

const RENAME: Record<string, string> = { b: 'strong', i: 'em' }
const INLINE = new Set(['strong', 'em', 'u', 'a', 'br'])
const BLOCK = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote'])
const BLOCKISH = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'pre', 'figure', 'figcaption', 'address', 'dd', 'dt', 'tr', 'table', 'tbody', 'thead', 'tfoot', 'dl', 'hr', 'h1', 'h4', 'h5', 'h6', 'p', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote'])
/** Dropped together with their content. */
const DROP = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'head', 'title', 'meta', 'link', 'canvas', 'video', 'audio', 'select', 'textarea', 'button', 'input', 'img', 'picture', 'source', 'track', 'map', 'frame', 'frameset', 'applet', 'base'])

export const SAFE_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

/** A safe absolute link (https, http, mailto) or null. */
export function safeHref(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s || s.length > 2000) return null
  try {
    const url = new URL(s)
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function hasBlockDescendant(el: Element): boolean {
  for (const child of Array.from(el.querySelectorAll('*'))) if (BLOCKISH.has(child.localName)) return true
  return false
}

/** The allowed tag an element maps to: a tag name, 'unwrap' (keep children), or 'drop'. */
function mapTag(el: Element, insideLink: boolean): string {
  const name = el.localName
  if (DROP.has(name)) return 'drop'
  const renamed = RENAME[name] ?? name
  if (renamed === 'a') return insideLink || !safeHref(el.getAttribute('href')) ? 'unwrap' : 'a'
  if (INLINE.has(renamed) || BLOCK.has(renamed)) return renamed
  if (name === 'h1') return 'h2'
  if (name === 'h4' || name === 'h5' || name === 'h6') return 'h3'
  if ((name === 'div' || name === 'pre' || name === 'section' || name === 'article') && !hasBlockDescendant(el)) return 'p'
  return 'unwrap'
}

function copyChildren(from: Node, to: Node, doc: Document, insideLink: boolean, depth: number): void {
  if (depth > 40) {
    // Absurd nesting: keep the text only.
    const text = from.textContent ?? ''
    if (text) to.appendChild(doc.createTextNode(text))
    return
  }
  for (const node of Array.from(from.childNodes)) {
    if (node.nodeType === 3) {
      to.appendChild(doc.createTextNode(node.nodeValue ?? ''))
      continue
    }
    if (node.nodeType !== 1) continue // comments, processing instructions, …
    const el = node as Element
    const tag = mapTag(el, insideLink)
    if (tag === 'drop') continue
    if (tag === 'unwrap') {
      copyChildren(el, to, doc, insideLink, depth + 1)
      // A dropped block still ends a line.
      if (BLOCKISH.has(el.localName) && to.lastChild && to.lastChild.nodeName !== 'BR') to.appendChild(doc.createElement('br'))
      continue
    }
    const out = doc.createElement(tag)
    if (tag === 'a') {
      out.setAttribute('href', safeHref(el.getAttribute('href')) as string)
      out.setAttribute('rel', 'noopener noreferrer')
      out.setAttribute('target', '_blank')
    }
    if (tag !== 'br') copyChildren(el, out, doc, insideLink || tag === 'a', depth + 1)
    to.appendChild(out)
  }
}

/** Wrap loose top-level inline runs in <p>, drop trailing <br>s and empty blocks. */
function normalise(frag: DocumentFragment, doc: Document): void {
  const nodes = Array.from(frag.childNodes)
  let para: HTMLElement | null = null
  for (const node of nodes) {
    const isBlock = node.nodeType === 1 && BLOCK.has((node as Element).localName)
    if (isBlock) { para = null; continue }
    if (node.nodeType === 1 && (node as Element).localName === 'br' && para) {
      // <br> between loose runs: start a new paragraph.
      frag.removeChild(node)
      para = null
      continue
    }
    if (!para) {
      if (node.nodeType === 3 && !(node.nodeValue ?? '').trim()) { frag.removeChild(node); continue }
      if (node.nodeType === 1 && (node as Element).localName === 'br') { frag.removeChild(node); continue }
      para = doc.createElement('p')
      frag.insertBefore(para, node)
    }
    para.appendChild(node)
  }
  // Trailing <br> inside blocks (contenteditable leaves them) and empty blocks.
  for (const el of Array.from(frag.querySelectorAll('p, h2, h3, li, blockquote, strong, em, u, a'))) {
    while (el.lastChild && el.lastChild.nodeName === 'BR' && el.childNodes.length > 1) el.removeChild(el.lastChild)
    if (!(el.textContent ?? '').trim() && !el.querySelector('br')) el.remove()
    else if (!(el.textContent ?? '').trim() && el.childNodes.length === 1 && el.firstChild?.nodeName === 'BR' && el.localName !== 'p') el.remove()
  }
  // Empty paragraphs at the very start / end.
  const isBlank = (n: ChildNode | null) => !!n && n.nodeType === 1 && !(n.textContent ?? '').trim()
  while (isBlank(frag.firstChild)) frag.removeChild(frag.firstChild as ChildNode)
  while (isBlank(frag.lastChild)) frag.removeChild(frag.lastChild as ChildNode)
}

/** Sanitise a DOM subtree (its children) into a fresh fragment of `doc`. */
export function sanitizeNode(root: Node, doc: Document = document): DocumentFragment {
  const frag = doc.createDocumentFragment()
  copyChildren(root, frag, doc, false, 0)
  normalise(frag, doc)
  return frag
}

/** Parse untrusted HTML in an inert document and sanitise it. */
export function sanitizeHtmlToFragment(input: string, doc: Document = document): DocumentFragment {
  let body: Node
  try {
    body = new DOMParser().parseFromString(String(input ?? ''), 'text/html').body
  } catch {
    // No DOMParser: keep the text only (never parse it with innerHTML).
    const frag = doc.createDocumentFragment()
    frag.appendChild(doc.createTextNode(String(input ?? '')))
    body = frag
  }
  return sanitizeNode(body, doc)
}

/** Serialise a fragment we built ourselves (only allowed tags and attributes). */
export function serialise(frag: DocumentFragment): string {
  const box = document.createElement('div')
  box.appendChild(frag.cloneNode(true))
  return box.innerHTML
}

export function sanitizeHtml(input: string): string {
  return serialise(sanitizeHtmlToFragment(input))
}

/** Plain text with line breaks: blocks and <br> end lines, list items get "• " / "1. ". */
export function plainTextOf(frag: Node): string {
  const lines: string[] = []
  let line = ''
  const flush = () => { lines.push(line.replace(/[ \t ]+/g, ' ').trim()); line = '' }
  const walk = (node: Node, listKind: string | null) => {
    let index = 0
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { line += (child.nodeValue ?? '').replace(/\s+/g, ' '); continue }
      if (child.nodeType !== 1) continue
      const name = (child as Element).localName
      if (name === 'br') { flush(); continue }
      if (name === 'ul' || name === 'ol') { if (line.trim()) flush(); walk(child, name); continue }
      if (name === 'li') {
        if (line.trim()) flush()
        index++
        line += listKind === 'ol' ? `${index}. ` : '• '
        walk(child, null)
        flush()
        continue
      }
      if (BLOCK.has(name)) { if (line.trim()) flush(); walk(child, null); flush(); continue }
      walk(child, null)
    }
  }
  walk(frag, null)
  if (line.trim()) flush()
  // Collapse runs of blank lines, trim the ends.
  const out: string[] = []
  for (const l of lines) if (l || (out.length && out[out.length - 1])) out.push(l)
  while (out.length && !out[out.length - 1]) out.pop()
  return out.join('\n')
}
