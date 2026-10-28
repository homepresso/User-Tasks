import type { ForeignKey, SchemaCache } from './schema'
import { PgrstError } from './errors'

/**
 * Relationships between tables, derived from foreign keys the way PostgREST
 * derives them:
 *  - many-to-one from the table holding the FK, one-to-many back from the
 *    referenced table; both are one-to-one when the FK columns are exactly
 *    the primary key or a unique constraint of the referencing table;
 *  - many-to-many through a junction table whose two FKs' columns are all
 *    part of the junction's primary key.
 * Embedding resolves a target (table name, FK constraint name or single FK
 * column) plus an optional `!hint` (constraint, FK column, referenced column
 * or junction table) to exactly one relationship, or fails with PGRST200 /
 * PGRST201 like PostgREST.
 */

export type Cardinality = 'm2o' | 'o2m' | 'o2o' | 'm2m'

export interface Relationship {
  source: string
  target: string
  cardinality: Cardinality
  /** FK constraint (m2o/o2m/o2o). For m2m, the junction's FK to the source. */
  constraint: string
  /** [source column, target column] pairs (m2o/o2m/o2o). */
  pairs: Array<[string, string]>
  /** o2o seen from the referenced table (the "parent" side). */
  isParent?: boolean
  junction?: {
    table: string
    /** FK from the junction to the source, and to the target. */
    sourceFk: ForeignKey
    targetFk: ForeignKey
  }
}

const relCache = new WeakMap<SchemaCache, Map<string, Relationship[]>>()

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

export function relationshipsFrom(cache: SchemaCache, source: string): Relationship[] {
  let bySource = relCache.get(cache)
  if (!bySource) {
    bySource = buildRelationships(cache)
    relCache.set(cache, bySource)
  }
  return bySource.get(source) ?? []
}

function buildRelationships(cache: SchemaCache): Map<string, Relationship[]> {
  const out = new Map<string, Relationship[]>()
  const add = (rel: Relationship) => {
    const list = out.get(rel.source) ?? []
    list.push(rel)
    out.set(rel.source, list)
  }
  const m2o: ForeignKey[] = []
  for (const fk of cache.foreignKeys) {
    const table = cache.tables.get(fk.table)
    if (!table || !cache.tables.has(fk.refTable)) continue
    const o2o = table.uniqueKeys.some((key) => sameSet(key, fk.columns))
    const pairs = fk.columns.map((c, i) => [c, fk.refColumns[i]] as [string, string])
    add({ source: fk.table, target: fk.refTable, cardinality: o2o ? 'o2o' : 'm2o', constraint: fk.name, pairs, isParent: false })
    add({
      source: fk.refTable,
      target: fk.table,
      cardinality: o2o ? 'o2o' : 'o2m',
      constraint: fk.name,
      pairs: pairs.map(([a, b]) => [b, a]),
      isParent: true,
    })
    if (!o2o) m2o.push(fk)
  }
  // Junctions: two distinct many-to-one FKs of the same table, all of whose
  // columns are part of that table's primary key.
  for (const a of m2o) {
    for (const b of m2o) {
      if (a.table !== b.table || a.name === b.name) continue
      const pk = new Set(cache.tables.get(a.table)?.primaryKey ?? [])
      if (![...a.columns, ...b.columns].every((c) => pk.has(c))) continue
      add({
        source: a.refTable,
        target: b.refTable,
        cardinality: 'm2m',
        constraint: a.name,
        pairs: [],
        junction: { table: a.table, sourceFk: a, targetFk: b },
      })
    }
  }
  // PostgREST sorts each (table, foreign table) group by the derived Ord of
  // Relationship: self flag, then cardinality (O2M < M2O < O2O < M2M), then
  // constraint / junction.
  for (const list of out.values()) list.sort((x, y) => cmp(sortKey(x), sortKey(y)))
  return out
}

const CARD_RANK: Record<Cardinality, number> = { o2m: 0, m2o: 1, o2o: 2, m2m: 3 }

function sortKey(r: Relationship): Array<string | number> {
  return [
    r.target,
    r.source === r.target ? 1 : 0,
    CARD_RANK[r.cardinality],
    r.junction ? r.junction.table : r.constraint,
    r.junction ? `${r.junction.sourceFk.name}|${r.junction.targetFk.name}` : JSON.stringify(r.pairs),
  ]
}

function cmp(a: Array<string | number>, b: Array<string | number>): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  return 0
}

function singleCols(r: Relationship): [string, string] | null {
  return r.cardinality !== 'm2m' && r.pairs.length === 1 ? r.pairs[0] : null
}

/** Name equals the origin-side column of a single-column FK (matchFKSingleCol). */
function matchFKSingleCol(r: Relationship, name: string): boolean {
  return singleCols(r)?.[0] === name
}

/** Name equals the foreign-side column (matchFKRefSingleCol). */
function matchFKRefSingleCol(r: Relationship, name: string): boolean {
  return singleCols(r)?.[1] === name
}

function matchesConstraint(r: Relationship, name: string): boolean {
  return r.cardinality !== 'm2m' && r.constraint === name
}

export function cardinalityLabel(c: Cardinality): string {
  return { m2o: 'many-to-one', o2m: 'one-to-many', o2o: 'one-to-one', m2m: 'many-to-many' }[c]
}

/** compressedRel (Error.hs). */
function describe(r: Relationship): string {
  if (r.junction) {
    const { table, sourceFk, targetFk } = r.junction
    return `${table} using ${sourceFk.name}(${sourceFk.columns.join(', ')}) and ${targetFk.name}(${targetFk.columns.join(', ')})`
  }
  return `${r.constraint} using ${r.source}(${r.pairs.map((p) => p[0]).join(', ')}) and ${r.target}(${r.pairs.map((p) => p[1]).join(', ')})`
}

export function resolveRelationship(cache: SchemaCache, source: string, target: string, hint: string | null): Relationship {
  // findRel (Plan.hs), including its self-relationship convention.
  const candidates = relationshipsFrom(cache, source).filter((r) => {
    if (r.source === r.target) {
      if (hint === null) return (r.target === target && r.cardinality === 'o2m') || (matchFKSingleCol(r, target) && r.cardinality === 'm2o')
      return r.target === target && r.cardinality === 'o2m' && matchFKRefSingleCol(r, hint)
    }
    if (hint === null) return r.target === target || matchesConstraint(r, target) || matchFKSingleCol(r, target)
    return (
      r.target === target &&
      (matchesConstraint(r, hint) ||
        matchFKSingleCol(r, hint) ||
        matchFKRefSingleCol(r, hint) ||
        (r.cardinality === 'm2m' && r.junction?.table === hint))
    )
  })
  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0) {
    throw new PgrstError(400, {
      code: 'PGRST200',
      message: `Could not find a relationship between '${source}' and '${target}' in the schema cache`,
      details: `Searched for a foreign key relationship between '${source}' and '${target}'${hint ? ` using the hint '${hint}'` : ''} in the schema '${cache.schema}', but no matches were found.`,
      hint: null,
    })
  }
  throw new PgrstError(300, {
    code: 'PGRST201',
    message: `Could not embed because more than one relationship was found for '${source}' and '${target}'`,
    details: candidates.map((r) => ({
      cardinality: cardinalityLabel(r.cardinality),
      embedding: `${source} with ${r.target}`,
      relationship: describe(r),
    })),
    hint: `Try changing '${target}' to one of the following: ${candidates
      .map((r) => `'${r.target}!${r.junction ? r.junction.table : r.constraint}'`)
      .join(', ')}. Find the desired relationship in the 'details' key.`,
  })
}

export function isToOne(r: Relationship): boolean {
  return r.cardinality === 'm2o' || r.cardinality === 'o2o'
}
