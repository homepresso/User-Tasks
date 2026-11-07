/**
 * The public, static indexes the header search box filters in the browser:
 * the docs search index (/docs/search-index.json, lib/docs/render
 * buildSearchIndex) and the gallery index (/gallery/index.json). Both are
 * fetched once, lazily, the first time someone searches.
 */

import { matchScore, matchesAllWords } from './rank'

/** /docs/search-index.json entry: title, href, section, description. */
export interface DocsIndexEntry { t: string; h: string; s?: string; d?: string }

/** The parts of a /gallery/index.json package the search box uses. */
export interface GalleryIndexItem { slug: string; title: string; summary?: string; category?: string; tags?: string[] }

function ranked<T>(items: T[], query: string, title: (item: T) => string, text: (item: T) => string, limit: number): T[] {
  const q = query.trim()
  if (q.length < 2) return []
  return items
    .filter((item) => matchesAllWords(text(item), q))
    .map((item, index) => ({ item, index, score: matchScore(title(item), q) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item)
}

/** Docs pages and headings matching the query (pages before their headings on ties). */
export function searchDocsIndex(entries: DocsIndexEntry[], query: string, limit = 4): DocsIndexEntry[] {
  return ranked(entries.filter((e) => e && typeof e.t === 'string' && typeof e.h === 'string' && e.h.startsWith('/docs')), query,
    (e) => e.t, (e) => `${e.t} ${e.s ?? ''} ${e.d ?? ''}`, limit)
}

/** Gallery packages matching the query by title, summary, category or tag. */
export function searchGalleryIndex(items: GalleryIndexItem[], query: string, limit = 4): GalleryIndexItem[] {
  return ranked(items.filter((p) => p && typeof p.slug === 'string' && /^[a-z0-9-]+$/.test(p.slug) && typeof p.title === 'string'), query,
    (p) => p.title, (p) => `${p.title} ${p.summary ?? ''} ${p.category ?? ''} ${(p.tags ?? []).join(' ')}`, limit)
}
