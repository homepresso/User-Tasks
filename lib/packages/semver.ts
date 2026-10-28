/**
 * Small semantic-version helpers for package versions and dependency
 * ranges: `1.2.3`, `1.2.3-beta.1`; ranges `*`, `1.2.3`, `=1.2.3`, `^1.2`,
 * `~1.2.3`, `>=1.0.0 <2.0.0`, `1.x`, and `||` alternatives.
 */

export interface SemVer { major: number; minor: number; patch: number; prerelease: string[] }

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseSemver(value: string): SemVer | null {
  const match = SEMVER.exec(String(value ?? '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split('.') : [] }
}

export function isSemver(value: string): boolean {
  return parseSemver(value) !== null
}

export function formatSemver(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}${version.prerelease.length ? `-${version.prerelease.join('.')}` : ''}`
}

/** -1 / 0 / 1 (prereleases sort before their release). Invalid versions sort first. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) return !x && !y ? 0 : !x ? -1 : 1
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1
  }
  if (!x.prerelease.length || !y.prerelease.length) return x.prerelease.length === y.prerelease.length ? 0 : x.prerelease.length ? -1 : 1
  for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
    const p = x.prerelease[i]
    const q = y.prerelease[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

export type BumpKind = 'major' | 'minor' | 'patch'

export function bumpSemver(version: string | null | undefined, kind: BumpKind = 'patch'): string {
  const parsed = version ? parseSemver(version) : null
  if (!parsed) return '1.0.0'
  if (kind === 'major') return `${parsed.major + 1}.0.0`
  if (kind === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`
  return parsed.prerelease.length ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

function partial(value: string): { parts: number[] } | null {
  const cleaned = value.replace(/^v/, '')
  if (cleaned === '*' || cleaned === 'x' || cleaned === '') return { parts: [] }
  const pieces = cleaned.split('-')[0].split('.')
  const parts: number[] = []
  for (const piece of pieces) {
    if (piece === 'x' || piece === '*' || piece === 'X') break
    if (!/^\d+$/.test(piece)) return null
    parts.push(Number(piece))
  }
  return { parts }
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const match = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(comparator.trim())
  if (!match) return false
  const [, op = '', rest] = match
  const p = partial(rest)
  if (!p) return false
  const [ma = 0, mi = 0, pa = 0] = p.parts
  const base = `${ma}.${mi}.${pa}`
  const cmp = compareSemver(version, rest.includes('-') && p.parts.length === 3 ? rest.replace(/^v/, '') : base)
  switch (op) {
    case '>': return cmp > 0
    case '>=': return cmp >= 0
    case '<': return cmp < 0
    case '<=': return cmp <= 0
    case '^': {
      if (cmp < 0) return false
      const upper = ma > 0 || p.parts.length < 2 ? `${ma + 1}.0.0` : mi > 0 || p.parts.length < 3 ? `0.${mi + 1}.0` : `0.0.${pa + 1}`
      return compareSemver(version, upper) < 0
    }
    case '~': {
      if (cmp < 0) return false
      const upper = p.parts.length < 2 ? `${ma + 1}.0.0` : `${ma}.${mi + 1}.0`
      return compareSemver(version, upper) < 0
    }
    default: {
      if (p.parts.length === 3) return cmp === 0
      // Partial = x-range: 1 → >=1.0.0 <2.0.0, 1.2 → >=1.2.0 <1.3.0, * → any.
      if (p.parts.length === 0) return parseSemver(version) !== null
      if (cmp < 0) return false
      const upper = p.parts.length === 1 ? `${ma + 1}.0.0` : `${ma}.${mi + 1}.0`
      return compareSemver(version, upper) < 0
    }
  }
}

/** Does `version` satisfy `range`? */
export function satisfiesRange(version: string, range: string): boolean {
  if (!parseSemver(version)) return false
  return String(range ?? '*').split('||').some((alternative) => {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean)
    return comparators.length === 0 || comparators.every((comparator) => satisfiesComparator(version, comparator))
  })
}

export function isValidRange(range: string): boolean {
  return String(range ?? '').split('||').every((alternative) => alternative.trim().split(/\s+/).filter(Boolean).every((comparator) => {
    const match = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(comparator)
    return Boolean(match && partial(match[2]))
  }))
}
