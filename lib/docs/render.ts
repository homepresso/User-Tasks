/**
 * Turns a docs page into the blocks the page component renders: parses its
 * Markdown, expands generated-reference and include directives (at build
 * time — every docs route is statically generated), and derives the table of
 * contents and the client-side search index from the result.
 */

import { GENERATED_DIRECTIVES } from './generated'
import { parseMarkdown, stripInline, type DocBlock } from './markdown'
import { ALL_DOC_PAGES, DOC_SECTIONS, docHref, sectionOf } from './registry'
import { SCREENSHOT_NAMES } from './screenshot-names'
import { TOPOLOGY_IDS } from '../topologies'
import type { DocPageDef } from './types'

/** Directives rendered by the page component itself rather than expanded here. */
const RENDERED_DIRECTIVES = new Set(['image', 'topology'])

export function expandBlocks(blocks: DocBlock[], depth = 0): DocBlock[] {
  if (depth > 3) throw new Error('docs: directive includes nested too deeply')
  const out: DocBlock[] = []
  for (const block of blocks) {
    if (block.kind !== 'directive') {
      out.push(block)
      continue
    }
    if (RENDERED_DIRECTIVES.has(block.name)) {
      if (block.name === 'image' && !SCREENSHOT_NAMES.includes(block.args[0] as (typeof SCREENSHOT_NAMES)[number])) {
        throw new Error(`docs: unknown screenshot "${block.args[0]}"`)
      }
      if (block.name === 'topology' && !TOPOLOGY_IDS.includes(block.args[0])) {
        throw new Error(`docs: unknown topology "${block.args[0]}"`)
      }
      out.push(block)
      continue
    }
    const generate = GENERATED_DIRECTIVES[block.name]
    if (!generate) throw new Error(`docs: unknown directive ::${block.name}`)
    out.push(...expandBlocks(generate(block.args), depth + 1))
  }
  return dedupeIds(out)
}

/** Generated and included blocks can repeat heading ids; keep anchors unique per page. */
function dedupeIds(blocks: DocBlock[]): DocBlock[] {
  const seen = new Map<string, number>()
  return blocks.map((block) => {
    if (block.kind !== 'heading') return block
    const count = seen.get(block.id) ?? 0
    seen.set(block.id, count + 1)
    return count === 0 ? block : { ...block, id: `${block.id}-${count + 1}` }
  })
}

const cache = new Map<string, DocBlock[]>()

export function pageBlocks(page: DocPageDef): DocBlock[] {
  const cached = cache.get(page.slug)
  if (cached) return cached
  const blocks = expandBlocks(parseMarkdown(page.body))
  cache.set(page.slug, blocks)
  return blocks
}

export interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}

export function tableOfContents(page: DocPageDef, blocks: DocBlock[]): TocEntry[] {
  const depth = page.tocDepth ?? 3
  return blocks
    .filter((block): block is Extract<DocBlock, { kind: 'heading' }> => block.kind === 'heading' && block.level <= depth)
    .map((block) => ({ id: block.id, text: stripInline(block.text), level: block.level as 2 | 3 }))
}

export interface SearchEntry {
  /** Title shown in results. */
  t: string
  /** Link. */
  h: string
  /** Section / page context. */
  s: string
  /** Extra text matched but not shown (description). */
  d?: string
}

/** Pages, plus every h2/h3 heading as its own entry (node names, CLI commands, functions…). */
export function buildSearchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [{ t: 'Documentation home', h: '/docs', s: 'Docs', d: 'overview introduction' }]
  for (const page of ALL_DOC_PAGES) {
    const section = sectionOf(page.slug)?.title ?? ''
    entries.push({ t: page.title, h: docHref(page.slug), s: section, d: page.description })
    for (const block of pageBlocks(page)) {
      if (block.kind === 'heading' && block.level <= 3) {
        entries.push({ t: stripInline(block.text), h: `${docHref(page.slug)}#${block.id}`, s: page.title })
      }
    }
  }
  for (const section of DOC_SECTIONS) {
    for (const link of section.links ?? []) entries.push({ t: link.title, h: link.href, s: section.title })
  }
  return entries
}
