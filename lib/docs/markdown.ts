/**
 * A small Markdown parser for the public docs. Pages are written as Markdown
 * strings (lib/docs/content) and some are included from repository files
 * (docs/*.md, docs/changes/*.md), so the subset covers what those files use:
 * headings, paragraphs, nested lists, fenced code, pipe tables, blockquotes
 * (rendered as callouts) and `::directive` lines for generated references,
 * screenshots and file includes. Inline markup (code, bold, italic, links)
 * stays in the text and is rendered by components/docs/inline.tsx.
 *
 * Pure and dependency-free so tests and the search index can use it.
 */

export interface DocListItem {
  text: string
  items?: DocListItem[]
}

export type DocBlock =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; start?: number; items: DocListItem[] }
  | { kind: 'code'; lang: string; code: string; title?: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'callout'; tone: 'note' | 'tip' | 'warning'; text: string }
  | { kind: 'directive'; name: string; args: string[] }

export interface ParseOptions {
  /** Added to every heading level (`#` → h2 with 1). Default 0. */
  headingShift?: number
  /** Rewrites link targets (e.g. repository-relative .md links). */
  resolveLink?: (href: string) => string | null
}

/**
 * Anchor id, GitHub style (lower case, punctuation dropped, spaces → dashes),
 * so links written for the repository's Markdown files keep working here.
 */
export function slugify(text: string): string {
  return stripInline(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** Plain text of an inline-Markdown string (for ids, search and titles). */
export function stripInline(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1$2')
}

const FENCE = /^(\s*)(```+|~~~+)\s*([\w+-]*)\s*(?:title="([^"]*)")?\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const DIRECTIVE = /^::([a-z][a-z0-9-]*)\s*(.*)$/
/** `<!-- ::name args -->`: a directive hidden from other Markdown renderers (GitHub). */
const COMMENT_DIRECTIVE = /^<!--\s*(::[a-z][a-z0-9-]*.*?)\s*-->$/

function splitRow(line: string): string[] {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1)
  const cells: string[] = []
  let current = ''
  let inCode = false
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (char === '\\' && body[i + 1] === '|') {
      current += '|'
      i++
      continue
    }
    if (char === '`') inCode = !inCode
    if (char === '|' && !inCode) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function rewriteLinks(text: string, resolveLink?: ParseOptions['resolveLink']): string {
  if (!resolveLink) return text
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const resolved = resolveLink(href)
    return resolved === null ? label : `[${label}](${resolved})`
  })
}

export function parseMarkdown(source: string, options: ParseOptions = {}): DocBlock[] {
  const shift = options.headingShift ?? 0
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: DocBlock[] = []
  const usedIds = new Map<string, number>()
  const inline = (text: string) => rewriteLinks(text, options.resolveLink)

  const uniqueId = (text: string) => {
    const base = slugify(text) || 'section'
    const count = usedIds.get(base) ?? 0
    usedIds.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const indent = fence[1].length
      const marker = fence[2]
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        const raw = lines[i]
        code.push(raw.slice(Math.min(indent, raw.length - raw.trimStart().length)))
        i++
      }
      i++ // closing fence
      blocks.push({ kind: 'code', lang: fence[3] || 'text', code: code.join('\n'), ...(fence[4] ? { title: fence[4] } : {}) })
      continue
    }

    const directive = DIRECTIVE.exec(COMMENT_DIRECTIVE.exec(line.trim())?.[1] ?? line.trim())
    if (directive) {
      const args = directive[2].trim() ? directive[2].split('|').map((arg) => arg.trim()) : []
      blocks.push({ kind: 'directive', name: directive[1], args })
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = Math.min(4, Math.max(2, heading[1].length + shift)) as 2 | 3 | 4
      const text = inline(heading[2])
      blocks.push({ kind: 'heading', level, text, id: uniqueId(text) })
      i++
      continue
    }

    if (line.trimStart().startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const head = splitRow(line).map(inline)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        const cells = splitRow(lines[i]).map(inline)
        while (cells.length < head.length) cells.push('')
        rows.push(cells.slice(0, head.length))
        i++
      }
      blocks.push({ kind: 'table', head, rows })
      continue
    }

    if (line.trimStart().startsWith('>')) {
      const quoted: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        quoted.push(lines[i].trimStart().replace(/^>\s?/, ''))
        i++
      }
      let tone: 'note' | 'tip' | 'warning' = 'note'
      const marker = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*$/i.exec(quoted[0] ?? '')
      if (marker) {
        quoted.shift()
        const kind = marker[1].toUpperCase()
        tone = kind === 'TIP' ? 'tip' : kind === 'NOTE' ? 'note' : 'warning'
      }
      const text = quoted.join('\n').split(/\n\s*\n/).map((para) => inline(para.replace(/\s*\n\s*/g, ' ').trim())).filter(Boolean).join('\n\n')
      blocks.push({ kind: 'callout', tone, text })
      continue
    }

    const listMatch = LIST_ITEM.exec(line)
    if (listMatch) {
      const baseIndent = listMatch[1].length
      const ordered = /\d/.test(listMatch[2])
      const root: DocListItem[] = []
      // Stack of [indent, items] for nesting.
      const stack: Array<{ indent: number; items: DocListItem[] }> = [{ indent: baseIndent, items: root }]
      let last: DocListItem | null = null
      while (i < lines.length) {
        const current = lines[i]
        if (!current.trim()) {
          // A blank line ends the list unless the next line continues it.
          const next = lines[i + 1]
          const nextItem = next !== undefined ? LIST_ITEM.exec(next) : null
          if (nextItem && nextItem[1].length >= baseIndent && /\d/.test(nextItem[2]) === ordered) {
            i++
            continue
          }
          if (next !== undefined && /^\s{2,}\S/.test(next) && !FENCE.test(next) && last) {
            i++
            continue
          }
          break
        }
        if (FENCE.test(current)) break
        const item = LIST_ITEM.exec(current)
        if (item) {
          const indent = item[1].length
          if (indent < baseIndent) break
          if (indent === baseIndent && /\d/.test(item[2]) !== ordered) break
          while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop()
          if (indent > stack[stack.length - 1].indent && last) {
            last.items = last.items ?? []
            stack.push({ indent, items: last.items })
          }
          last = { text: inline(item[3].trim()) }
          stack[stack.length - 1].items.push(last)
          i++
          continue
        }
        if (/^\s+\S/.test(current) && last) {
          last.text = `${last.text} ${inline(current.trim())}`
          i++
          continue
        }
        break
      }
      const start = ordered ? Number.parseInt(listMatch[2], 10) : undefined
      blocks.push({ kind: 'list', ordered, ...(ordered && start !== 1 ? { start } : {}), items: root })
      continue
    }

    // Paragraph: consecutive non-blank lines that start no other block.
    const para: string[] = []
    while (i < lines.length && lines[i].trim()) {
      const current = lines[i]
      if (para.length > 0 && (FENCE.test(current) || HEADING.test(current) || LIST_ITEM.test(current) || current.trimStart().startsWith('>') || DIRECTIVE.test(current.trim()))) break
      if (para.length > 0 && current.trimStart().startsWith('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) break
      para.push(current.trim())
      i++
    }
    blocks.push({ kind: 'paragraph', text: inline(para.join(' ')) })
  }

  return blocks
}
