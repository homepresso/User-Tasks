/** String similarity: Levenshtein edit distance and Jaro-Winkler (by code point). */

export function levenshtein(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  if (x.length === 0) return y.length
  if (y.length === 0) return x.length
  let prev = new Array<number>(y.length + 1)
  let cur = new Array<number>(y.length + 1)
  for (let j = 0; j <= y.length; j++) prev[j] = j
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[y.length]
}

export function jaro(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  if (x.length === 0 && y.length === 0) return 1
  if (x.length === 0 || y.length === 0) return 0
  const window = Math.max(0, Math.floor(Math.max(x.length, y.length) / 2) - 1)
  const xm = new Array<boolean>(x.length).fill(false)
  const ym = new Array<boolean>(y.length).fill(false)
  let matches = 0
  for (let i = 0; i < x.length; i++) {
    const lo = Math.max(0, i - window)
    const hi = Math.min(y.length - 1, i + window)
    for (let j = lo; j <= hi; j++) {
      if (!ym[j] && x[i] === y[j]) {
        xm[i] = true
        ym[j] = true
        matches++
        break
      }
    }
  }
  if (matches === 0) return 0
  let k = 0
  let transpositions = 0
  for (let i = 0; i < x.length; i++) {
    if (!xm[i]) continue
    while (!ym[k]) k++
    if (x[i] !== y[k]) transpositions++
    k++
  }
  const t = transpositions / 2
  return (matches / x.length + matches / y.length + (matches - t) / matches) / 3
}

/** Jaro-Winkler with the standard prefix scale 0.1 and a prefix of up to 4. */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b)
  const x = Array.from(a)
  const y = Array.from(b)
  let prefix = 0
  while (prefix < 4 && prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix++
  return j + prefix * 0.1 * (1 - j)
}
