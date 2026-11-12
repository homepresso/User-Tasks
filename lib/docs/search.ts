/**
 * Fuzzy ranking for the docs command palette (components/docs/search-palette).
 * Pure and dependency-free: it runs in the browser over
 * /docs/search-index.json and in tests. Only type imports here, so the
 * palette chunk does not pull in the docs registry.
 */

import type { SearchEntry } from './render'

export interface SearchResult {
  entry: SearchEntry
  score: number
  /** [start, end) ranges of the title to highlight. */
  ranges: Array<[number, number]>
}

export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
}

/** Positions of `term`'s characters in order inside `text`, preferring word starts; null if absent. */
function subsequence(text: string, term: string): number[] | null {
  const positions: number[] = []
  let from = 0
  for (const char of term) {
    let found = -1
    // A later word-start match beats an earlier mid-word one ("ak" → "API keys").
    for (let index = from; index < text.length; index++) {
      if (text[index] !== char) continue
      if (found < 0) found = index
      if (index === 0 || /[\s/:._-]/.test(text[index - 1])) { found = index; break }
    }
    if (found < 0) return null
    positions.push(found)
    from = found + 1
  }
  return positions
}

function termScore(title: string, rest: string, term: string): { score: number; ranges: Array<[number, number]> } | null {
  const at = title.indexOf(term)
  if (at >= 0) {
    const ranges: Array<[number, number]> = [[at, at + term.length]]
    if (title === term) return { score: 14, ranges }
    if (at === 0) return { score: 10, ranges }
    if (/[\s/:._(-]/.test(title[at - 1])) return { score: 8, ranges }
    return { score: 5, ranges }
  }
  if (rest.includes(term)) return { score: 2, ranges: [] }
  // Typo-tolerant fallback: the letters in order, tightly packed.
  if (term.length >= 3) {
    const positions = subsequence(title, term)
    if (positions) {
      const spread = positions[positions.length - 1] - positions[0] + 1
      if (spread <= term.length * 3) {
        return { score: 1 + term.length / spread, ranges: positions.map((position) => [position, position + 1] as [number, number]) }
      }
    }
  }
  return null
}

/** Merges overlapping or touching ranges, sorted. */
export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const range of sorted) {
    const last = out[out.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else out.push([range[0], range[1]])
  }
  return out
}

/** Every term must match the title, section or description; titles weigh most. */
export function scoreEntry(entry: SearchEntry, terms: string[]): SearchResult | null {
  if (terms.length === 0) return null
  const title = entry.t.toLowerCase()
  const rest = `${entry.s} ${entry.d ?? ''}`.toLowerCase()
  let score = 0
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    const match = termScore(title, rest, term)
    if (!match) return null
    score += match.score
    ranges.push(...match.ranges)
  }
  // Pages rank above their headings for the same match; shorter titles are closer matches.
  if (!entry.h.includes('#')) score += 1.5
  score += Math.max(0, 1 - title.length / 80)
  return { entry, score, ranges: mergeRanges(ranges) }
}

export function searchDocs(index: SearchEntry[], query: string, limit = 20): SearchResult[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return []
  const results: SearchResult[] = []
  for (const entry of index) {
    const result = scoreEntry(entry, terms)
    if (result) results.push(result)
  }
  return results.sort((a, b) => b.score - a.score || a.entry.t.length - b.entry.t.length).slice(0, limit)
}

/** Splits a title into plain and highlighted parts. */
export function highlightParts(text: string, ranges: Array<[number, number]>): Array<{ text: string; match: boolean }> {
  const parts: Array<{ text: string; match: boolean }> = []
  let last = 0
  for (const [start, end] of mergeRanges(ranges)) {
    if (start > last) parts.push({ text: text.slice(last, start), match: false })
    parts.push({ text: text.slice(start, end), match: true })
    last = end
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false })
  return parts
}
