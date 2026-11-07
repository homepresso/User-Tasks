/**
 * Ranking for the header search box: an exact name match first, then names
 * that start with the query, then a word in the name that starts with it,
 * then anything else that matched (description, id…). Ties keep the order
 * the rows came in (most recently updated first). Pure, so the server
 * (lib/services/search) and the client (pages, docs, gallery) rank alike.
 */

export function matchScore(title: string | null | undefined, query: string): number {
  const t = String(title ?? '').trim().toLowerCase()
  const q = query.trim().toLowerCase()
  if (!t || !q) return 0
  if (t === q) return 4
  if (t.startsWith(q)) return 3
  if (t.split(/[\s\-_/·.,:()]+/).some((word) => word.startsWith(q))) return 2
  if (t.includes(q)) return 1
  return 0
}

/** Stable sort by matchScore (best first). */
export function rankByMatch<T>(items: T[], query: string, titleOf: (item: T) => string | null | undefined): T[] {
  return items
    .map((item, index) => ({ item, index, score: matchScore(titleOf(item), query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}

/** Every word of the query appears somewhere in the text (client-side filters). */
export function matchesAllWords(text: string, query: string): boolean {
  const haystack = text.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word))
}
