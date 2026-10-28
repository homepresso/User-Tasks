import { PgrstError } from './errors'
import type { AggFn, Field, Filter, JsonOp, LogicTree, OpExpr, OrderTerm, QueryParams, Range, SelectItem } from './parse'
import { isToOne, resolveRelationship, type Relationship } from './relationships'
import type { PgFunction, SchemaCache, Table } from './schema'
import { arrayLiteral, ident, isSafeCast, qident, SqlBuilder } from './sql'

/**
 * Read/mutate/call plans and their SQL, ported from PostgREST v14
 * (Plan.hs, Query/QueryBuilder.hs, Query/SqlFragment.hs, Query/Statements.hs).
 * The generated statements have the same shape as PostgREST's — lateral
 * joins with json_agg / row_to_json, a `pgrst_source` CTE and an aggregate
 * over `_postgrest_t` — so results, counts and Postgres errors line up.
 */

export const SOURCE_CTE = 'pgrst_source'

// ── Coercible (schema-resolved) pieces ──────────────────────────────────────

interface CField {
  name: string
  path: JsonOp[]
  /** Non-json column with a JSON path: `to_jsonb(col)->...`. */
  toJson: boolean
  fullRow: boolean
  /** fts operators wrap the column in to_tsvector() unless it already is one. */
  toTsVector: { lang: string | null } | null
}

interface CSelect {
  field: CField
  agg: AggFn | null
  aggCast: string | null
  cast: string | null
  alias: string | null
}

type CFilter =
  | { kind: 'filter'; field: CField; expr: OpExpr }
  | { kind: 'nullEmbed'; not: boolean; aggAlias: string }

type CLogic = { type: 'stmt'; filter: CFilter } | { type: 'expr'; not: boolean; op: 'and' | 'or'; children: CLogic[] }

type COrder =
  | { kind: 'field'; field: CField; dir: OrderTerm['dir']; nulls: OrderTerm['nulls'] }
  | { kind: 'rel'; relation: string; name: string; path: JsonOp[]; dir: OrderTerm['dir']; nulls: OrderTerm['nulls'] }

interface JoinCond {
  left: [string, string]
  leftCol: string
  right: [string, string]
  rightCol: string
}

type RelSelect =
  | { kind: 'embed'; selName: string; aggAlias: string; toOne: boolean; empty: boolean }
  | { kind: 'spread'; aggAlias: string; fields: Array<{ name: string; alias: string | null }> }

export interface ReadNode {
  fromSchema: string
  fromName: string
  fromAlias: string | null
  select: CSelect[]
  where: CLogic[]
  order: COrder[]
  range: Range
  relName: string
  relAlias: string | null
  relHint: string | null
  joinType: 'inner' | 'left' | null
  spread: boolean
  depth: number
  rel: Relationship | null
  joinConds: JoinCond[]
  aggAlias: string
  relSelect: RelSelect[]
  children: ReadNode[]
}

const ALL_RANGE: Range = { offset: 0, limit: null }

function resolveField(table: Table | undefined, field: Field, tsLang: { lang: string | null } | null = null): CField {
  const col = table?.columns.get(field.name)
  const isJson = col?.type === 'json' || col?.type === 'jsonb'
  const isTsVector = col?.baseType === 'tsvector'
  return {
    name: field.name,
    path: field.path,
    toJson: !isJson,
    fullRow: false,
    toTsVector: isTsVector ? null : tsLang,
  }
}

function unknownField(name: string, path: JsonOp[]): CField {
  return { name, path, toJson: false, fullRow: false, toTsVector: null }
}

// ── Read plan ───────────────────────────────────────────────────────────────

export type Action = 'read' | 'mutate' | 'call'

export interface ReadPlanInput {
  cache: SchemaCache
  /** Table (or function's return table / function name for calls) the plan reads. */
  rootName: string
  action: Action
  params: QueryParams
  aggregatesEnabled: boolean
  /** db-max-rows: caps every node of a read (not a mutation's representation). */
  maxRows?: number | null
}

function notEmbedded(name: string): PgrstError {
  return new PgrstError(400, {
    code: 'PGRST108',
    message: `'${name}' is not an embedded resource in this request`,
    details: null,
    hint: `Verify that '${name}' is included in the 'select' query parameter.`,
  })
}

function findNode(root: ReadNode, path: string[]): ReadNode {
  let node = root
  for (const name of path) {
    const next = node.children.find((c) => c.relName === name || c.relAlias === name)
    if (!next) throw notEmbedded(name)
    node = next
  }
  return node
}

function initNode(cache: SchemaCache, name: string, depth: number, items: SelectItem[], extra: Partial<ReadNode> = {}): ReadNode {
  const table = cache.tables.get(name)
  const node: ReadNode = {
    fromSchema: cache.schema,
    fromName: name,
    fromAlias: null,
    select: [],
    where: [],
    order: [],
    range: ALL_RANGE,
    relName: name,
    relAlias: null,
    relHint: null,
    joinType: null,
    spread: false,
    depth,
    rel: null,
    joinConds: [],
    aggAlias: '',
    relSelect: [],
    children: [],
    ...extra,
  }
  for (const item of items) {
    if (item.type === 'relation') {
      node.children.push(
        initNode(cache, item.name, depth + 1, item.children, {
          relAlias: item.spread ? null : item.alias,
          relHint: item.hint,
          joinType: item.joinType,
          spread: item.spread,
        }),
      )
    } else {
      node.select.push({ field: resolveField(table, item.field), agg: item.agg, aggCast: item.aggCast, cast: item.cast, alias: item.alias })
    }
  }
  return node
}

function resolveLogic(table: Table | undefined, tree: LogicTree): CLogic {
  if (tree.type === 'stmt') return { type: 'stmt', filter: resolveFilter(table, tree.filter) }
  return { type: 'expr', not: tree.not, op: tree.op, children: tree.children.map((t) => resolveLogic(table, t)) }
}

function resolveFilter(table: Table | undefined, f: Filter): CFilter {
  const expr = f.expr as OpExpr
  const ts = expr.operation.kind === 'fts' ? { lang: expr.operation.lang } : null
  return { kind: 'filter', field: resolveField(table, f.field, ts), expr }
}

export function buildReadPlan(input: ReadPlanInput): ReadNode {
  const { cache, rootName, action, params } = input
  const rootTable = cache.tables.get(rootName)
  const root = initNode(cache, rootName, 0, params.select)
  const tableOf = (node: ReadNode) => cache.tables.get(node.fromName)

  // Filters: reads and calls take them all; mutations only the embedded ones
  // (root filters go to the UPDATE/DELETE itself).
  for (const [path, filter] of params.filters) {
    if (action === 'mutate' && path.length === 0) continue
    const node = findNode(root, path)
    node.where.unshift({ type: 'stmt', filter: resolveFilter(tableOf(node), filter) })
  }
  for (const [path, terms] of params.order) {
    const node = findNode(root, path)
    // PostgREST resolves order columns against the root table at every level.
    node.order = terms.map((t): COrder =>
      t.relation
        ? { kind: 'rel', relation: t.relation, name: t.field.name, path: t.field.path, dir: t.dir, nulls: t.nulls }
        : { kind: 'field', field: resolveField(rootTable, t.field), dir: t.dir, nulls: t.nulls },
    )
  }
  if (action !== 'mutate') {
    for (const [key, range] of params.ranges) {
      const node = findNode(root, key === '' ? [] : key.split('.'))
      node.range = range
    }
  }
  for (const [path, tree] of params.logic) {
    if (action === 'mutate' && path.length === 0) continue
    const node = findNode(root, path)
    node.where.unshift(resolveLogic(tableOf(node), tree))
  }

  // Relationships, aliases and join conditions.
  if (action !== 'read') {
    root.fromSchema = ''
    root.fromName = SOURCE_CTE
    root.fromAlias = rootName
  }
  const addRels = (parent: ReadNode, parentTable: string) => {
    for (const child of parent.children) {
      const origin = child.depth === 1 ? (parent.fromAlias ?? parentTable) : parentTable
      const rel = resolveRelationship(cache, origin, child.relName, child.relHint)
      child.rel = rel
      child.fromSchema = cache.schema
      child.fromName = rel.target
      child.aggAlias = `${rel.source}_${child.relAlias ?? child.relName}_${child.depth}`
      if (child.spread && !isToOne(rel)) {
        throw new PgrstError(400, {
          code: 'PGRST127',
          message: 'Feature not implemented',
          details: 'pg-query does not support spreading one-to-many or many-to-many relationships',
          hint: null,
        })
      }
      const parentQi: [string, string] = parent.fromAlias ? ['', parent.fromAlias] : [cache.schema, rel.source]
      if (rel.cardinality === 'm2m' && rel.junction) {
        child.fromAlias = null
        const { table: jt, sourceFk, targetFk } = rel.junction
        child.joinConds = [
          ...targetFk.columns.map((jc, i): JoinCond => ({ left: [cache.schema, jt], leftCol: jc, right: [cache.schema, rel.target], rightCol: targetFk.refColumns[i] })),
          ...sourceFk.columns.map((jc, i): JoinCond => ({ left: [cache.schema, jt], leftCol: jc, right: parentQi, rightCol: sourceFk.refColumns[i] })),
        ]
      } else {
        child.fromAlias = `${rel.target}_${child.depth}`
        child.joinConds = rel.pairs.map(([srcCol, tgtCol]) => ({
          left: ['', child.fromAlias as string],
          leftCol: tgtCol,
          right: parentQi,
          rightCol: srcCol,
        }))
      }
      addRels(child, rel.target)
    }
  }
  addRels(root, rootName)

  const finish = (node: ReadNode) => {
    // Aliases for JSON paths: the last key (or, for an index, the last key before it).
    node.select = node.select.map((s) => {
      if (s.alias || s.agg || s.field.path.length === 0) return s
      const last = s.field.path[s.field.path.length - 1]
      if (!last.isIdx) return { ...s, alias: last.key }
      const lastKey = [...s.field.path].reverse().find((p) => !p.isIdx)
      return { ...s, alias: lastKey ? lastKey.key : s.field.name }
    })
    // Ordering by a to-one embed's column uses that embed's lateral alias.
    node.order = node.order.map((o) => {
      if (o.kind !== 'rel') return o
      const child = node.children.find((c) => (c.relAlias ?? c.relName) === o.relation)
      if (!child) throw notEmbedded(o.relation)
      if (!child.rel || !isToOne(child.rel)) {
        throw new PgrstError(400, {
          code: 'PGRST118',
          message: `A related order on '${o.relation}' is not possible`,
          details: `'${node.fromName}' and '${o.relation}' do not form a many-to-one or one-to-one relationship`,
          hint: null,
        })
      }
      return { ...o, relation: child.aggAlias }
    })
    // `embed=is.null` / `embed=not.is.null` filter on the embed's existence.
    const nullEmbed = (t: CLogic): CLogic => {
      if (t.type === 'expr') return { ...t, children: t.children.map(nullEmbed) }
      const f = t.filter
      if (f.kind !== 'filter' || f.field.path.length > 0) return t
      const child = node.children.find((c) => (c.relAlias ?? c.relName) === f.field.name)
      if (child && f.expr.operation.kind === 'is' && f.expr.operation.value === 'null') {
        return { type: 'stmt', filter: { kind: 'nullEmbed', not: f.expr.not, aggAlias: child.aggAlias } }
      }
      return t
    }
    node.where = node.where.map(nullEmbed)
    for (const child of node.children) finish(child)
    node.relSelect = node.children.map((child): RelSelect => {
      if (child.spread) {
        return {
          kind: 'spread',
          aggAlias: child.aggAlias,
          fields: [
            ...child.select.map((s) => ({ name: s.alias ?? s.field.name, alias: null })),
            ...child.relSelect.flatMap((r) => (r.kind === 'embed' ? [{ name: r.selName, alias: null }] : r.fields)),
          ],
        }
      }
      return {
        kind: 'embed',
        selName: child.relAlias ?? child.relName,
        aggAlias: child.aggAlias,
        toOne: isToOne(child.rel as Relationship),
        empty: isEmptyEmbed(child),
      }
    })
    if (!input.aggregatesEnabled && node.select.some((s) => s.agg)) {
      throw new PgrstError(400, { code: 'PGRST123', message: 'Use of aggregate functions is not allowed', details: null, hint: null })
    }
    for (const s of node.select) {
      for (const cast of [s.cast, s.aggCast]) {
        if (cast && !isSafeCast(cast)) throw new PgrstError(400, { code: 'PGRST100', message: 'Invalid cast', details: cast, hint: null })
      }
    }
  }
  finish(root)
  // treeRestrictRange: every level of a read or call returns at most maxRows.
  if (input.maxRows && action !== 'mutate') {
    const max = input.maxRows
    const restrict = (node: ReadNode) => {
      if (node.range.limit !== 0) node.range = { offset: node.range.offset, limit: Math.min(node.range.limit ?? Infinity, max) }
      node.children.forEach(restrict)
    }
    restrict(root)
  }
  return root
}

function isEmptyEmbed(node: ReadNode): boolean {
  return node.select.length === 0 && node.children.every(isEmptyEmbed)
}

// ── SQL ─────────────────────────────────────────────────────────────────────

/** Qualifier for a node's columns: its alias, else the schema-qualified table. */
function nodeQi(node: ReadNode): [string, string] {
  return node.fromAlias ? ['', node.fromAlias] : [node.fromSchema, node.fromName]
}

function fmtColumn(qi: [string, string], col: string): string {
  return col === '*' ? `${qident(qi[0], qi[1])}.*` : `${qident(qi[0], qi[1])}.${ident(col)}`
}

function fmtJsonPath(sql: SqlBuilder, path: JsonOp[]): string {
  return path.map((p) => `${p.arrow}${p.isIdx ? `${sql.param(p.key)}::int` : sql.param(p.key)}`).join('')
}

function fmtField(sql: SqlBuilder, qi: [string, string], f: CField): string {
  let base: string
  if (f.fullRow) base = ident(qi[1])
  else if (f.path.length === 0) base = fmtColumn(qi, f.name)
  else if (f.toJson) base = `to_jsonb(${fmtColumn(qi, f.name)})${fmtJsonPath(sql, f.path)}`
  else base = `${fmtColumn(qi, f.name)}${fmtJsonPath(sql, f.path)}`
  if (f.toTsVector) return `to_tsvector(${f.toTsVector.lang !== null ? `${sql.param(f.toTsVector.lang)}, ` : ''}${base})`
  return base
}

function applyCast(cast: string | null, s: string): string {
  return cast ? `CAST( ${s} AS ${cast} )` : s
}

function fmtSelectItem(sql: SqlBuilder, qi: [string, string], s: CSelect): string {
  let out = applyCast(s.cast, fmtField(sql, qi, s.field))
  if (s.agg) out = applyCast(s.aggCast, `${s.agg.toUpperCase()}(${out})`)
  return out + (s.alias ? ` AS ${ident(s.alias)}` : '')
}

const SIMPLE_SQL: Record<string, string> = { neq: '<>', cs: '@>', cd: '<@', ov: '&&', sl: '<<', sr: '>>', nxr: '&<', nxl: '&>', adj: '-|-' }
const QUANT_SQL: Record<string, string> = { eq: '=', gte: '>=', gt: '>', lte: '<=', lt: '<', like: 'like', ilike: 'ilike', match: '~', imatch: '~*' }
const FTS_SQL: Record<string, string> = { fts: '@@ to_tsquery', plfts: '@@ plainto_tsquery', phfts: '@@ phraseto_tsquery', wfts: '@@ websearch_to_tsquery' }
const IS_SQL: Record<string, string> = { null: 'NULL', not_null: 'NOT NULL', true: 'TRUE', false: 'FALSE', unknown: 'UNKNOWN' }

function fmtFilter(sql: SqlBuilder, qi: [string, string], f: CFilter): string {
  if (f.kind === 'nullEmbed') return `${ident(f.aggAlias)} IS ${f.not ? '' : 'NOT '}DISTINCT FROM NULL`
  const op = f.expr.operation
  const lhs = `${f.expr.not ? 'NOT' : ''} ${fmtField(sql, qi, f.field)}`
  switch (op.kind) {
    case 'op':
      return `${lhs} ${SIMPLE_SQL[op.op]} ${sql.param(op.value)}`
    case 'quant': {
      const value = op.op === 'like' || op.op === 'ilike' ? op.value.replace(/\*/g, '%') : op.value
      const p = sql.param(value)
      const rhs = op.quant === 'any' ? `ANY(${p})` : op.quant === 'all' ? `ALL(${p})` : p
      return `${lhs} ${QUANT_SQL[op.op]} ${rhs}`
    }
    case 'is':
      return `${lhs} IS ${IS_SQL[op.value]}`
    case 'isdistinct':
      return `${lhs} IS DISTINCT FROM ${sql.param(op.value)}`
    case 'in':
      if (op.values.length === 1 && op.values[0] === '') return `${lhs} = ANY('{}') `
      return `${lhs} = ANY (${sql.param(arrayLiteral(op.values))}) `
    case 'fts':
      return `${lhs} ${FTS_SQL[op.op]}(${op.lang !== null ? `${sql.param(op.lang)}, ` : ''}${sql.param(op.value)}) `
  }
}

function fmtLogic(sql: SqlBuilder, qi: [string, string], t: CLogic): string {
  if (t.type === 'stmt') return fmtFilter(sql, qi, t.filter)
  return `${t.not ? 'NOT' : ''} (${t.children.map((c) => fmtLogic(sql, qi, c)).join(t.op === 'and' ? ' AND ' : ' OR ')})`
}

function fmtJoinCond(j: JoinCond): string {
  return `${fmtColumn(j.left, j.leftCol)} = ${fmtColumn(j.right, j.rightCol)}`
}

function fmtOrder(sql: SqlBuilder, qi: [string, string], order: COrder[]): string {
  if (order.length === 0) return ''
  return (
    'ORDER BY ' +
    order
      .map((o) => {
        const term = o.kind === 'field' ? fmtField(sql, qi, o.field) : fmtField(sql, ['', o.relation], unknownField(o.name, o.path))
        const dir = o.dir === 'asc' ? 'ASC' : o.dir === 'desc' ? 'DESC' : ''
        const nulls = o.nulls === 'first' ? 'NULLS FIRST' : o.nulls === 'last' ? 'NULLS LAST' : ''
        return `${term} ${[dir, nulls].join(' ')}`
      })
      .join(', ')
  )
}

function fmtLimitOffset(sql: SqlBuilder, range: Range): string {
  if (range.offset === 0 && range.limit === null) return ''
  return `LIMIT ${range.limit === null ? 'ALL' : sql.param(String(range.limit))} OFFSET ${sql.param(String(range.offset))}`
}

function fromFrag(node: ReadNode): string {
  let out = ` FROM ${qident(node.fromSchema, node.fromName)}`
  if (node.fromAlias) out += ` AS ${ident(node.fromAlias)}`
  if (node.rel?.cardinality === 'm2m' && node.rel.junction) out += `, ${qident(node.fromSchema, node.rel.junction.table)}`
  return out
}

export function readPlanToQuery(sql: SqlBuilder, node: ReadNode): string {
  const qi = nodeQi(node)
  const defSelect: CSelect[] = [{ field: unknownField('*', []), agg: null, aggCast: null, cast: null, alias: null }]
  const selects = (node.select.length === 0 && node.children.length === 0 ? defSelect : node.select).map((s) => fmtSelectItem(sql, qi, s))
  const joinSelects: string[] = []
  const joins: string[] = []
  for (const rs of node.relSelect) {
    const child = node.children.find((c) => c.aggAlias === rs.aggAlias) as ReadNode
    const agg = ident(rs.aggAlias)
    const joinKw = child.joinType === 'inner' ? 'INNER' : 'LEFT'
    const lateral = (sub: string, cond: string) => ` ${joinKw} JOIN LATERAL ( ${sub} ) AS ${agg} ON ${cond}`
    if (rs.kind === 'spread') {
      for (const f of rs.fields) joinSelects.push(`${f.name === '*' ? `${agg}.*` : `${agg}.${ident(f.name)}`}${f.alias ? ` AS ${ident(f.alias)}` : ''}`)
      joins.push(lateral(readPlanToQuery(sql, child), 'TRUE'))
    } else if (rs.toOne) {
      if (!rs.empty) joinSelects.push(`row_to_json(${agg}.*)::jsonb AS ${ident(rs.selName)}`)
      joins.push(lateral(readPlanToQuery(sql, child), 'TRUE'))
    } else {
      if (!rs.empty) joinSelects.push(`COALESCE( ${agg}.${agg}, '[]') AS ${ident(rs.selName)}`)
      const sub = `SELECT json_agg(${agg})::jsonb AS ${agg} FROM (${readPlanToQuery(sql, child)} ) AS ${agg}`
      joins.push(lateral(sub, child.joinType === 'inner' ? `${agg} IS NOT NULL` : 'TRUE'))
    }
  }
  const where = [...node.where.map((t) => fmtLogic(sql, qi, t)), ...node.joinConds.map(fmtJoinCond)]
  return (
    'SELECT ' +
    [...selects, ...joinSelects].join(', ') +
    fromFrag(node) +
    joins.join(' ') +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ' +
    groupBy(qi, node, sql) +
    ' ' +
    fmtOrder(sql, qi, node.order) +
    ' ' +
    fmtLimitOffset(sql, node.range)
  )
}

function groupBy(qi: [string, string], node: ReadNode, sql: SqlBuilder): string {
  if (!node.select.some((s) => s.agg)) return ''
  const terms = [
    ...node.select.filter((s) => !s.agg).map((s) => (s.alias ? ident(s.alias) : fmtField(sql, qi, s.field))),
    ...node.relSelect.filter((r) => r.kind === 'embed').map((r) => ident((r as { selName: string }).selName)),
  ]
  return terms.length ? ' GROUP BY ' + terms.join(', ') : ''
}

/** COUNT query for the root: filters only, inner embeds as EXISTS. */
export function readPlanToCountQuery(sql: SqlBuilder, node: ReadNode): string {
  const qi = nodeQi(node)
  const fmtCountLogic = (t: CLogic): string => {
    if (t.type === 'expr') return `${t.not ? 'NOT' : ''} (${t.children.map(fmtCountLogic).join(t.op === 'and' ? ' AND ' : ' OR ')})`
    const f = t.filter
    if (f.kind === 'nullEmbed') {
      const child = node.children.find((c) => c.aggAlias === f.aggAlias)
      return child ? `${f.not ? '' : 'NOT '}EXISTS (${readPlanToCountQuery(sql, child)})` : ''
    }
    return fmtFilter(sql, qi, f)
  }
  const subQueries = node.children.filter((c) => c.joinType === 'inner').map((c) => `EXISTS (${readPlanToCountQuery(sql, c)} )`)
  const parts = [...node.where.map(fmtCountLogic), ...node.joinConds.map(fmtJoinCond), ...subQueries]
  return 'SELECT 1 ' + fromFrag(node) + (parts.length ? ' WHERE ' + parts.join(' AND ') : '')
}

// ── Main statements ─────────────────────────────────────────────────────────

export type BodyHandler = 'array' | 'single' | 'none'

function bodyFor(handler: BodyHandler, fn: PgFunction | null): string {
  const scalar = fn ? !fn.returnsSet && !fn.returnsComposite : false
  const setOfScalar = fn ? fn.returnsSet && !fn.returnsComposite : false
  const singleComposite = fn ? !fn.returnsSet && fn.returnsComposite : false
  if (handler === 'none') return "''::text"
  if (handler === 'single') return scalar ? "coalesce(json_agg(_postgrest_t.pgrst_scalar)->0, 'null')" : "coalesce(json_agg(_postgrest_t)->0, 'null')"
  if (singleComposite) return "coalesce(json_agg(_postgrest_t)->0, 'null')"
  if (scalar) return "coalesce(json_agg(_postgrest_t.pgrst_scalar)->0, 'null')"
  if (setOfScalar) return "coalesce(json_agg(_postgrest_t.pgrst_scalar), '[]')"
  return "coalesce(json_agg(_postgrest_t), '[]')"
}

export function mainRead(sql: SqlBuilder, plan: ReadNode, count: boolean, handler: BodyHandler): string {
  const select = readPlanToQuery(sql, plan)
  const countCte = count ? `, pgrst_source_count AS (${readPlanToCountQuery(sql, plan)})` : ''
  return (
    `WITH ${SOURCE_CTE} AS ( ${select} ) ${countCte} SELECT ` +
    `${count ? '(SELECT pg_catalog.count(*) FROM pgrst_source_count)' : 'null::bigint'} AS total_result_set, ` +
    `pg_catalog.count(_postgrest_t) AS page_total, (${bodyFor(handler, null)})::text AS body, '' AS response_inserted ` +
    `FROM ( SELECT * FROM ${SOURCE_CTE} ) _postgrest_t`
  )
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface MutationInput {
  kind: 'insert' | 'update' | 'delete'
  table: Table
  /** Columns from `columns` or the payload keys (sorted, like PostgREST's Set). */
  columns: string[]
  /** Raw JSON body text. */
  body: string | null
  bodyIsObject: boolean
  resolution: 'merge' | 'ignore' | null
  onConflict: string[] | null
  /** Root filters and logic (UPDATE/DELETE). */
  filters: Filter[]
  logic: LogicTree[]
  returnRepresentation: boolean
  applyDefaults: boolean
}

function columnNotFound(table: string, col: string): PgrstError {
  return new PgrstError(400, {
    code: 'PGRST204',
    message: `Could not find the '${col}' column of '${table}' in the schema cache`,
    details: null,
    hint: null,
  })
}

/** RETURNING columns needed by the representation (inferColsEmbedNeeds). */
function returningsFor(plan: ReadNode, pkCols: string[]): string[] {
  const names = new Set(plan.select.map((s) => s.field.name))
  if (names.has('*')) return ['*']
  for (const child of plan.children) {
    const rel = child.rel
    if (!rel) continue
    if (rel.cardinality === 'm2m' && rel.junction) rel.junction.sourceFk.refColumns.forEach((c) => names.add(c))
    else rel.pairs.forEach(([src]) => names.add(src))
  }
  pkCols.forEach((c) => names.add(c))
  return [...names].sort()
}

interface BodyField {
  name: string
  type: string
  default: string | null
}

/** pgrst_payload / pgrst_body lateral source over the JSON body (fromJsonBodyF). */
function fromJsonBody(sql: SqlBuilder, body: string | null, isObject: boolean, fields: BodyField[], includeSelect: boolean, limitOne: boolean, applyDefaults: boolean): string {
  const named = fields.map((f) => `"pgrst_body".${ident(f.name)}`).join(', ')
  const parsed = fields.map((f) => ident(f.name)).join(', ')
  const typed = fields.map((f) => `${ident(f.name)} ${f.type}`).join(', ')
  const placeholder = `${sql.param(body)}::${applyDefaults ? 'jsonb' : 'json'}`
  const defs = `jsonb_build_object(${fields
    .filter((f) => f.default !== null)
    .map((f) => `${literal(f.name)}, ${f.default}`)
    .join(',')})`
  const defaults = !applyDefaults
    ? ''
    : isObject
      ? `LATERAL (SELECT ${defs} || pgrst_payload.json_data AS val) pgrst_json_defs, `
      : `LATERAL (SELECT jsonb_agg(${defs} || elem) AS val from jsonb_array_elements(pgrst_payload.json_data) elem) pgrst_json_defs, `
  const finalBody = applyDefaults ? 'pgrst_json_defs.val' : 'pgrst_payload.json_data'
  const toRecord = applyDefaults ? (isObject ? 'jsonb_to_record' : 'jsonb_to_recordset') : isObject ? 'json_to_record' : 'json_to_recordset'
  const arrayElements = applyDefaults ? 'jsonb_array_elements' : 'json_array_elements'
  const source =
    fields.length === 0
      ? isObject
        ? '(values(1)) _ '
        : `${arrayElements}(${finalBody}) _ `
      : `${toRecord}(${finalBody}) AS _(${typed}) ${limitOne ? 'LIMIT 1' : ''}`
  return (
    (includeSelect ? `SELECT ${named} ` : '') +
    `FROM (SELECT ${placeholder} AS json_data) pgrst_payload, ` +
    defaults +
    `LATERAL (SELECT ${parsed} FROM ${source}) pgrst_body `
  )
}

/**
 * Column names are quoted identifiers from the schema cache; default
 * expressions come from pg_catalog. Only these schema-derived strings are
 * embedded as SQL literals (never request values).
 */
function literal(s: string): string {
  const escaped = `'${s.replace(/\0/g, '').replace(/'/g, "''")}'`
  return escaped.includes('\\') ? `E${escaped.replace(/\\/g, '\\\\')}` : escaped
}

const INSERTED = "nullif(current_setting('pgrst.inserted', true), '')"
const incInserted = (add: boolean) =>
  `set_config('pgrst.inserted', (coalesce(${INSERTED}::int, 0) ${add ? '+' : '-'} 1)::text, true) <> '${add ? '0' : '-1'}'`

export function mutationToQuery(sql: SqlBuilder, m: MutationInput, plan: ReadNode, schema: string): string {
  const mainQi: [string, string] = [schema, m.table.name]
  const tableSql = qident(schema, m.table.name)
  const returnings = m.returnRepresentation ? returningsFor(plan, m.table.primaryKey) : []
  const returning = returnings.length === 0 ? 'RETURNING 1' : 'RETURNING ' + returnings.map((c) => fmtColumn(mainQi, c)).join(', ')
  const fields: BodyField[] = m.columns.map((c) => {
    const col = m.table.columns.get(c)
    if (!col) throw columnNotFound(m.table.name, c)
    return { name: c, type: col.type, default: col.default }
  })
  // Built lazily: parameters are numbered in the order they're rendered.
  const whereSql = () => {
    const where = [
      ...m.filters.map((f) => fmtFilter(sql, mainQi, resolveFilter(m.table, f))),
      ...m.logic.map((t) => fmtLogic(sql, mainQi, resolveLogic(m.table, t))),
    ]
    return where.length ? ' WHERE ' + where.join(' AND ') : ''
  }

  if (m.kind === 'insert') {
    const merge = m.resolution === 'merge'
    const conflictCols = m.resolution ? (m.onConflict ?? m.table.primaryKey) : []
    let q =
      `INSERT INTO ${tableSql}` +
      (fields.length ? `(${fields.map((f) => ident(f.name)).join(', ')}) ` : ' ') +
      fromJsonBody(sql, m.body, m.bodyIsObject, fields, true, false, m.applyDefaults) +
      (merge ? 'WHERE ' + incInserted(true) : '')
    if (m.resolution && conflictCols.length) {
      q += ` ON CONFLICT(${conflictCols.map(ident).join(', ')}) `
      if (m.resolution === 'ignore' || fields.length === 0) q += 'DO NOTHING'
      else q += 'DO UPDATE SET ' + fields.map((f) => `${ident(f.name)} = EXCLUDED.${ident(f.name)}`).join(', ') + 'WHERE ' + incInserted(false)
    }
    return q + ' ' + returning
  }
  if (m.kind === 'update') {
    if (fields.length === 0) {
      const cols = returnings.length === 0 ? 'NULL' : returnings.map((c) => fmtColumn(['', m.table.name], c)).join(', ')
      return `SELECT ${cols} FROM ${tableSql} WHERE false`
    }
    return (
      `UPDATE ${tableSql} SET ` +
      fields.map((f) => `${ident(f.name)} = "pgrst_body".${ident(f.name)}`).join(', ') +
      ' ' +
      fromJsonBody(sql, m.body, m.bodyIsObject, fields, false, false, m.applyDefaults) +
      whereSql() +
      ' ' +
      returning
    )
  }
  return `DELETE FROM ${tableSql} ${whereSql()} ${returning}`
}

export function mainWrite(sql: SqlBuilder, mutation: string, plan: ReadNode, handler: BodyHandler, upsertMerge: boolean): string {
  const select = handler === 'none' ? `SELECT * FROM ${SOURCE_CTE}` : readPlanToQuery(sql, plan)
  return (
    `WITH ${SOURCE_CTE} AS (${mutation}) SELECT '' AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, ` +
    `(${bodyFor(handler, null)})::text AS body, ` +
    `${upsertMerge ? `${INSERTED}::int` : "''"} AS response_inserted ` +
    `FROM (${select}) _postgrest_t`
  )
}

// ── Calls ───────────────────────────────────────────────────────────────────

export interface CallInput {
  fn: PgFunction
  /** Parameters named in the request (in the function's order). */
  params: PgFunction['params']
  /** JSON body (POST) or direct text args (GET/HEAD). */
  jsonBody: string | null
  bodyIsObject: boolean
  directArgs: Map<string, string> | null
}

function filterFieldNames(node: ReadNode): string[] {
  const out: string[] = []
  const walk = (t: CLogic) => {
    if (t.type === 'expr') t.children.forEach(walk)
    else out.push(t.filter.kind === 'filter' ? t.filter.field.name : t.filter.aggAlias)
  }
  const visit = (n: ReadNode) => {
    n.where.forEach(walk)
    n.children.forEach(visit)
  }
  visit(node)
  return out
}

export function callToQuery(sql: SqlBuilder, c: CallInput, plan: ReadNode): string {
  const fnSql = qident(c.fn.schema, c.fn.name)
  const scalarish = !c.fn.returnsComposite
  const callIt = (args: string) => (scalarish ? `(SELECT ${fnSql}(${args}) pgrst_scalar) pgrst_call` : `${fnSql}(${args}) pgrst_call`)
  const onePos = c.fn.params.length === 1 && c.fn.params[0].name === ''
  let fromCall: string
  if (onePos) {
    fromCall = 'FROM ' + callIt(`${sql.param(c.jsonBody)}::${c.fn.params[0].type}`)
  } else if (c.params.length === 0) {
    fromCall = 'FROM ' + callIt('')
  } else if (c.directArgs) {
    fromCall =
      'FROM ' +
      callIt(
        c.params
          .map((p) => {
            const v = c.directArgs?.get(p.name)
            return `${p.variadic ? 'VARIADIC ' : ''}${ident(p.name)} := ${v === undefined ? 'NULL' : sql.param(v)}::${p.typeMaxLength}`
          })
          .join(', '),
      )
  } else {
    const fields = c.params.map((p) => ({ name: p.name, type: p.typeMaxLength, default: null }))
    fromCall =
      fromJsonBody(sql, c.jsonBody, c.bodyIsObject, fields, false, true, false) +
      ', LATERAL ' +
      callIt(c.params.map((p) => `${p.variadic ? 'VARIADIC ' : ''}${ident(p.name)} := pgrst_body.${ident(p.name)}`).join(', '))
  }
  let cols: string
  if (scalarish) cols = 'pgrst_call.pgrst_scalar'
  else {
    const returnings = returningsFor(plan, [])
    if (returnings.length === 0) cols = '*'
    else if (returnings.length === 1 && returnings[0] === '*') cols = '"pgrst_call".*'
    else cols = [...new Set([...returnings, ...filterFieldNames(plan)])].sort().map((r) => `"pgrst_call".${ident(r)}`).join(', ')
  }
  return `SELECT ${cols} ${fromCall}`
}

export function mainCall(sql: SqlBuilder, call: string, plan: ReadNode, fn: PgFunction, count: boolean, handler: BodyHandler): string {
  const countCte = count ? `, pgrst_source_count AS (${readPlanToCountQuery(sql, plan)})` : ''
  const select = readPlanToQuery(sql, plan)
  return (
    `WITH ${SOURCE_CTE} AS (${call}) ${countCte}SELECT ` +
    `${count ? '(SELECT pg_catalog.count(*) FROM pgrst_source_count)' : 'null::bigint'} AS total_result_set, ` +
    `${!fn.returnsSet ? '1' : 'pg_catalog.count(_postgrest_t)'} AS page_total, ` +
    `(${bodyFor(handler, fn)})::text AS body, '' AS response_inserted ` +
    `FROM (${select}) _postgrest_t`
  )
}
