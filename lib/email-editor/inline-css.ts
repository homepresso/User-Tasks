/**
 * CSS inliner for email HTML (dependency-free, pure).
 *
 * Moves rules from `<style>` blocks onto the elements they match as inline
 * `style` attributes — many email clients (Gmail in some modes, Outlook,
 * Yahoo) drop or ignore `<style>`. Supports the selectors email authors
 * use: type, `.class`, `#id`, `*`, compounds (`td.cta`), groups (`h1, h2`)
 * and descendant / child combinators (`.card p`, `tr > td`). Rules it cannot
 * inline — pseudo-classes (`a:hover`, `:root`), attribute selectors and
 * every at-rule (`@media`, `@font-face`, `@supports`) — stay in the
 * `<style>` block, so dark-mode and responsive rules keep working where
 * clients support them. Existing inline styles win over stylesheet rules;
 * otherwise specificity, then source order.
 */

import { tokenizeHtml, attrValue, serializeOpenTag, type HtmlAttr, type HtmlToken, VOID_ELEMENTS } from './html-tokens'

interface Compound { tag: string | null; id: string | null; classes: string[] }
interface ParsedSelector { parts: Compound[]; combinators: Array<' ' | '>'>; specificity: [number, number, number] }
interface InlineRule { selector: ParsedSelector; declarations: Array<[string, string]>; order: number }
interface ElementInfo { name: string; id: string | null; classes: string[] }

const SKIP_ELEMENTS = new Set(['html', 'head', 'meta', 'link', 'style', 'title', 'script', 'base', 'br', 'wbr'])

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Top-level blocks: `prelude { body }` with nested braces kept in body. */
function splitRules(css: string): Array<{ prelude: string; body: string; raw: string }> {
  const out: Array<{ prelude: string; body: string; raw: string }> = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open === -1) {
      const tail = css.slice(i).trim()
      // `@import url(...);` / `@charset` statements without a block.
      if (tail) for (const stmt of tail.split(';').map((s) => s.trim()).filter(Boolean)) out.push({ prelude: stmt, body: '', raw: `${stmt};` })
      break
    }
    // Statements before the block (e.g. `@import ...;` then a rule).
    let prelude = css.slice(i, open)
    const lastSemi = prelude.lastIndexOf(';')
    if (lastSemi !== -1 && !/\(/.test(prelude.slice(lastSemi))) {
      for (const stmt of prelude.slice(0, lastSemi).split(';').map((s) => s.trim()).filter(Boolean)) out.push({ prelude: stmt, body: '', raw: `${stmt};` })
      prelude = prelude.slice(lastSemi + 1)
    }
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, depth === 0 ? j - 1 : j)
    out.push({ prelude: prelude.trim(), body, raw: `${prelude.trim()} {${body}}` })
    i = j
  }
  return out
}

export function parseDeclarations(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  const push = (chunk: string) => {
    const colon = chunk.indexOf(':')
    if (colon === -1) return
    const prop = chunk.slice(0, colon).trim().toLowerCase()
    const value = chunk.slice(colon + 1).trim()
    if (prop && value && /^-?[a-z][a-z0-9-]*$/.test(prop)) out.push([prop, value])
  }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) { if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) { push(body.slice(start, i)); start = i + 1 }
  }
  push(body.slice(start))
  return out
}

const COMPOUND_RE = /^(\*|[a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/

export function parseSelector(selector: string): ParsedSelector | null {
  const s = selector.trim().replace(/\s*>\s*/g, ' > ').replace(/\s+/g, ' ')
  if (!s || /[:[\]+~,]/.test(s)) return null
  const tokens = s.split(' ')
  const parts: Compound[] = []
  const combinators: Array<' ' | '>'> = []
  let pending: ' ' | '>' = ' '
  let specificity: [number, number, number] = [0, 0, 0]
  for (const token of tokens) {
    if (token === '>') { pending = '>'; continue }
    const m = COMPOUND_RE.exec(token)
    if (!m) return null
    const tag = m[1] && m[1] !== '*' ? m[1].toLowerCase() : null
    const rest = m[2] ?? ''
    const ids = [...rest.matchAll(/#([\w-]+)/g)].map((x) => x[1])
    const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((x) => x[1])
    if (ids.length > 1) return null
    if (parts.length) combinators.push(pending)
    pending = ' '
    parts.push({ tag, id: ids[0] ?? null, classes })
    specificity = [specificity[0] + ids.length, specificity[1] + classes.length, specificity[2] + (tag ? 1 : 0)]
  }
  if (!parts.length || pending === '>' && tokens[tokens.length - 1] === '>') return null
  return { parts, combinators, specificity }
}

function compoundMatches(c: Compound, el: ElementInfo): boolean {
  if (c.tag && c.tag !== el.name) return false
  if (c.id && c.id !== el.id) return false
  for (const cls of c.classes) if (!el.classes.includes(cls)) return false
  return true
}

/** Does `selector` match the last element of `stack` (ancestors first)? */
export function selectorMatches(selector: ParsedSelector, stack: ElementInfo[]): boolean {
  const { parts, combinators } = selector
  const match = (partIndex: number, stackIndex: number): boolean => {
    if (!compoundMatches(parts[partIndex], stack[stackIndex])) return false
    if (partIndex === 0) return true
    const combinator = combinators[partIndex - 1]
    if (combinator === '>') return stackIndex > 0 && match(partIndex - 1, stackIndex - 1)
    for (let k = stackIndex - 1; k >= 0; k--) if (match(partIndex - 1, k)) return true
    return false
  }
  return stack.length > 0 && match(parts.length - 1, stack.length - 1)
}

function compareSpecificity(a: InlineRule, b: InlineRule): number {
  for (let i = 0; i < 3; i++) if (a.selector.specificity[i] !== b.selector.specificity[i]) return a.selector.specificity[i] - b.selector.specificity[i]
  return a.order - b.order
}

function elementInfo(token: Extract<HtmlToken, { kind: 'open' }>): ElementInfo {
  const cls = attrValue(token.attrs, 'class')
  return { name: token.name, id: attrValue(token.attrs, 'id'), classes: cls ? cls.split(/\s+/).filter(Boolean) : [] }
}

export interface InlineResult {
  html: string
  /** Rules moved onto elements. */
  inlined: number
  /** Rules kept in `<style>` (pseudo-classes, at-rules, attribute selectors). */
  kept: number
}

/** Inline the `<style>` rules of `html`. HTML without `<style>` is returned unchanged. */
export function inlineCss(html: string): InlineResult {
  if (!/<style[\s>]/i.test(html)) return { html, inlined: 0, kept: 0 }
  const tokens = tokenizeHtml(html)
  const rules: InlineRule[] = []
  const residualByToken = new Map<number, string>()
  let order = 0
  let kept = 0

  tokens.forEach((token, index) => {
    if (token.kind !== 'raw' || token.name !== 'style') return
    const residual: string[] = []
    for (const block of splitRules(stripComments(token.text))) {
      if (!block.prelude) continue
      if (block.prelude.startsWith('@')) { residual.push(block.raw.trim()); kept++; continue }
      const declarations = parseDeclarations(block.body)
      const keepSelectors: string[] = []
      for (const sel of block.prelude.split(',')) {
        const parsed = parseSelector(sel)
        if (parsed && declarations.length) rules.push({ selector: parsed, declarations, order: order++ })
        else keepSelectors.push(sel.trim())
      }
      if (keepSelectors.length) { residual.push(`${keepSelectors.join(', ')} {${block.body}}`); kept++ }
    }
    residualByToken.set(index, residual.join('\n'))
  })

  if (!rules.length) return { html, inlined: 0, kept }

  const used = new Set<InlineRule>()
  const stack: ElementInfo[] = []
  const pieces: string[] = []
  let cursor = 0
  const emit = (upto: number, replacement?: string, from?: number) => {
    pieces.push(html.slice(cursor, from ?? upto))
    if (replacement !== undefined) pieces.push(replacement)
    cursor = upto
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.kind === 'open') {
      const info = elementInfo(token)
      const isVoid = VOID_ELEMENTS.has(token.name) || token.selfClosing
      const path = [...stack, info]
      if (!SKIP_ELEMENTS.has(token.name)) {
        const matching = rules.filter((rule) => selectorMatches(rule.selector, path)).sort(compareSpecificity)
        if (matching.length) {
          const merged = new Map<string, string>()
          for (const rule of matching) {
            used.add(rule)
            for (const [prop, value] of rule.declarations) {
              const prev = merged.get(prop)
              // !important in the sheet beats later normal declarations.
              if (prev && /!important\s*$/i.test(prev) && !/!important\s*$/i.test(value)) continue
              merged.delete(prop)
              merged.set(prop, value)
            }
          }
          const existing = attrValue(token.attrs, 'style')
          if (existing) for (const [prop, value] of parseDeclarations(existing)) {
            const prev = merged.get(prop)
            if (prev && /!important\s*$/i.test(prev)) continue
            merged.delete(prop)
            merged.set(prop, value)
          }
          const style = [...merged].map(([p, v]) => `${p}:${v.replace(/"/g, "'")}`).join(';')
          const attrs: HtmlAttr[] = token.attrs.filter((a) => a.name !== 'style')
          attrs.push({ name: 'style', value: style })
          emit(token.end, serializeOpenTag(token.name, attrs, token.selfClosing), token.start)
        }
      }
      if (!isVoid) stack.push(info)
    } else if (token.kind === 'close') {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === token.name) { stack.length = k; break }
      }
    } else if (token.kind === 'raw' && token.name === 'style' && residualByToken.has(index)) {
      const residual = residualByToken.get(index)!
      if (residual.trim()) {
        emit(token.end, `\n${residual}\n`, token.start)
      } else {
        // Drop the now-empty <style>…</style> element.
        const openToken = tokens[index - 1]
        const closeToken = tokens[index + 1]
        if (openToken?.kind === 'open' && closeToken?.kind === 'close' && closeToken.name === 'style') {
          // Rewind the opening tag already copied (it starts at openToken.start).
          pieces.push(html.slice(cursor, openToken.start))
          cursor = closeToken.end
          stack.pop()
          index++
          continue
        }
        emit(token.end, '', token.start)
      }
    }
  }
  pieces.push(html.slice(cursor))
  return { html: pieces.join(''), inlined: used.size, kept }
}
