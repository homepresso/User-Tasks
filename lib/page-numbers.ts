/** The page numbers a pager shows: first, last and the pages around the current one (null = a gap "…"). */
export function pageNumbers(page: number, totalPages: number, around = 1): Array<number | null> {
  const out: Array<number | null> = []
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= around) out.push(p)
    else if (out[out.length - 1] !== null) out.push(null)
  }
  return out
}
