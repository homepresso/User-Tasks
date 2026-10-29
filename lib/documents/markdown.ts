/**
 * Markdown input: YAML front matter, the document model (headings, lists,
 * tables, links, code) from marked's lexer, and rendered HTML through the
 * allowlist sanitiser (lib/html-sanitize).
 */

import { decodeEntities, sanitizeHtml } from '@/lib/html-sanitize'
import type { Block, Inline } from './model'

export interface MarkdownReadResult {
  blocks: Block[]
  frontMatter: Record<string, unknown> | null
  body: string
  html: string
}

/** `---\n…\n---` at the very start → parsed YAML (safe: the yaml package builds plain data). */
export async function splitFrontMatter(text: string): Promise<{ frontMatter: Record<string, unknown> | null; body: string }> {
  const src = text.replace(/^﻿/, '')
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src)
  if (!m) return { frontMatter: null, body: src }
  try {
    const { parse } = await import('yaml')
    const data = parse(m[1], { maxAliasCount: 50 })
    return { frontMatter: data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : { value: data }, body: src.slice(m[0].length) }
  } catch {
    return { frontMatter: null, body: src }
  }
}

type Tok = { type: string; [key: string]: unknown }

function inlineTokens(tokens: Tok[] | undefined, fmt: Partial<Inline> = {}): Inline[] {
  const out: Inline[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong': out.push(...inlineTokens(t.tokens as Tok[], { ...fmt, bold: true })); break
      case 'em': out.push(...inlineTokens(t.tokens as Tok[], { ...fmt, italic: true })); break
      case 'del': out.push(...inlineTokens(t.tokens as Tok[], { ...fmt, strike: true })); break
      case 'codespan': out.push({ ...fmt, code: true, text: decodeEntities(String(t.text ?? '')) }); break
      case 'link': out.push(...inlineTokens(t.tokens as Tok[], { ...fmt, href: String(t.href ?? '') })); break
      case 'image': out.push({ ...fmt, text: `[${String(t.text ?? 'image')}]` }); break
      case 'br': out.push({ ...fmt, text: '\n' }); break
      case 'text':
        if (Array.isArray(t.tokens) && t.tokens.length) out.push(...inlineTokens(t.tokens as Tok[], fmt))
        else out.push({ ...fmt, text: decodeEntities(String(t.text ?? '')) })
        break
      case 'escape': out.push({ ...fmt, text: decodeEntities(String(t.text ?? '')) }); break
      case 'html': break
      default:
        if (typeof t.text === 'string') out.push({ ...fmt, text: decodeEntities(t.text) })
    }
  }
  return out
}

function cellText(cell: unknown): string {
  const c = cell as { text?: string; tokens?: Tok[] }
  return inlineTokens(c.tokens).map((i) => i.text).join('') || decodeEntities(c.text ?? '')
}

function walk(tokens: Tok[], out: Block[], listLevel = -1, ordered = false): void {
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': out.push({ type: 'heading', level: Number(t.depth) || 1, inlines: inlineTokens(t.tokens as Tok[]) }); break
      case 'paragraph':
        if (listLevel >= 0) out.push({ type: 'list_item', ordered, level: listLevel, inlines: inlineTokens(t.tokens as Tok[]) })
        else out.push({ type: 'paragraph', inlines: inlineTokens(t.tokens as Tok[]) })
        break
      case 'text':
        if (listLevel >= 0) out.push({ type: 'list_item', ordered, level: listLevel, inlines: inlineTokens((t.tokens as Tok[]) ?? [t]) })
        else out.push({ type: 'paragraph', inlines: inlineTokens((t.tokens as Tok[]) ?? [t]) })
        break
      case 'list':
        for (const item of (t.items as Tok[]) ?? []) {
          const kids = (item.tokens as Tok[]) ?? []
          const before = out.length
          walk(kids.filter((k) => k.type !== 'list'), out, listLevel + 1, Boolean(t.ordered))
          if (out.length === before) out.push({ type: 'list_item', ordered: Boolean(t.ordered), level: listLevel + 1, inlines: [] })
          walk(kids.filter((k) => k.type === 'list'), out, listLevel + 1, Boolean(t.ordered))
        }
        break
      case 'table': {
        const header = ((t.header as unknown[]) ?? []).map(cellText)
        const rows = ((t.rows as unknown[][]) ?? []).map((r) => r.map(cellText))
        out.push({ type: 'table', rows: [header, ...rows], header: true })
        break
      }
      case 'code': out.push({ type: 'code', text: String(t.text ?? ''), lang: t.lang ? String(t.lang) : undefined }); break
      case 'blockquote': {
        const inner: Block[] = []
        walk((t.tokens as Tok[]) ?? [], inner)
        for (const b of inner) out.push('inlines' in b && b.type !== 'heading' ? { type: 'quote', inlines: b.inlines } : b)
        break
      }
      case 'hr': out.push({ type: 'hr' }); break
    }
  }
}

export async function readMarkdown(text: string): Promise<MarkdownReadResult> {
  const { frontMatter, body } = await splitFrontMatter(text)
  const { Lexer, parse } = await import('marked')
  const tokens = Lexer.lex(body, { gfm: true }) as unknown as Tok[]
  const blocks: Block[] = []
  walk(tokens, blocks)
  const rendered = await parse(body, { gfm: true, async: true })
  return { blocks, frontMatter, body, html: sanitizeHtml(rendered) }
}

/** Markdown → sanitised HTML. */
export async function markdownToHtml(text: string): Promise<string> {
  const { body } = await splitFrontMatter(text)
  const { parse } = await import('marked')
  return sanitizeHtml(await parse(body, { gfm: true, async: true }))
}
