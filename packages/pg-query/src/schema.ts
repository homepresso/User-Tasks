/**
 * Schema cache: the tables, foreign keys, functions and role settings that
 * PostgREST keeps in its own schema cache, introspected from pg_catalog.
 *
 * Embedded resources are resolved from these foreign keys exactly the way
 * PostgREST resolves them (see ./relationships), and every relation and
 * function name in a request is checked against this cache before it reaches
 * SQL. Loaded lazily, refreshed on demand (a lookup miss refreshes at most once
 * per `refreshCooldownMs`, so tables created after start-up are picked up).
 */

export interface Queryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

export interface Column {
  name: string
  /** format_type() of the column, e.g. `uuid`, `text[]`, `task_status`. */
  type: string
  /** Base type name when the column is a domain over a pg_catalog type. */
  baseType: string
  nullable: boolean
  /** Default expression (pg_get_expr), for Prefer: missing=default. */
  default: string | null
}

export interface Table {
  schema: string
  name: string
  /** r, p, v, m, f */
  kind: string
  columns: Map<string, Column>
  /** Column names in attnum order. */
  columnOrder: string[]
  primaryKey: string[]
  /** Column sets of the primary key and unique constraints. */
  uniqueKeys: string[][]
}

export interface ForeignKey {
  name: string
  /** Referencing table (holds the FK columns). */
  table: string
  columns: string[]
  /** Referenced table. */
  refTable: string
  refColumns: string[]
}

export interface FunctionParam {
  name: string
  /** `type::regtype::text`, used in json_to_record() column definitions. */
  type: string
  /** Same, with bit/character widened to their varying forms (no length cut-off). */
  typeMaxLength: string
  required: boolean
  variadic: boolean
}

export interface PgFunction {
  schema: string
  name: string
  /** Input parameters (IN / INOUT / VARIADIC), in order. */
  params: FunctionParam[]
  returnsSet: boolean
  /** Row type (table, composite, OUT/INOUT/TABLE params). */
  returnsComposite: boolean
  /** Return type name: the composite's relation name, or the scalar type name. */
  returnTypeName: string
  returnTypeSchema: string
  /** i, s, v */
  volatility: string
}

export interface SchemaCache {
  schema: string
  tables: Map<string, Table>
  foreignKeys: ForeignKey[]
  functions: Map<string, PgFunction[]>
  /** Per role: GUCs PostgREST applies when it impersonates that role. */
  roleSettings: Map<string, Array<[string, string]>>
  /**
   * Impersonated roles that exist without BYPASSRLS (absent = has it, or
   * unknown). Only service_role is expected to bypass RLS; see PgExecutor.
   */
  rolesWithoutBypassRls?: Set<string>
}

const TABLES_SQL = `
select c.relname as name, c.relkind as kind,
       coalesce(json_agg(json_build_object(
         'name', a.attname,
         'type', format_type(a.atttypid, a.atttypmod),
         'baseType', format_type(coalesce(nullif(t.typbasetype, 0), t.oid), null),
         'nullable', not a.attnotnull,
         'default', case
           when t.typbasetype <> 0 and ad.adbin is null then pg_get_expr(t.typdefaultbin, 0)
           when a.attidentity = 'd' then format('nextval(%L)', seq.objid::regclass)
           when a.attgenerated = 's' then null
           else pg_get_expr(ad.adbin, ad.adrelid)
         end
       ) order by a.attnum) filter (where a.attnum is not null), '[]') as columns
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_type t on t.oid = a.atttypid
left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
left join pg_depend seq on seq.refobjid = c.oid and seq.refobjsubid = a.attnum and seq.deptype = 'i' and seq.classid = 'pg_class'::regclass
where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition
group by c.oid, c.relname, c.relkind`

const KEYS_SQL = `
select c.relname as table, k.contype as type,
       array(select a.attname::text from unnest(k.conkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum order by u.ord) as columns
from pg_constraint k
join pg_class c on c.oid = k.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = $1 and k.contype in ('p', 'u')`

const FKS_SQL = `
select k.conname as name, c.relname as table, rc.relname as ref_table,
       array(select a.attname::text from unnest(k.conkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum order by u.ord) as columns,
       array(select a.attname::text from unnest(k.confkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.attnum order by u.ord) as ref_columns
from pg_constraint k
join pg_class c on c.oid = k.conrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_class rc on rc.oid = k.confrelid
join pg_namespace rn on rn.oid = rc.relnamespace
where k.contype = 'f' and k.conparentid = 0 and n.nspname = $1 and rn.nspname = $1
order by k.conname`

// PostgREST's routine query (SqlFragment.baseFuncSqlQuery), minus privileges:
// the pool user sees every function; EXECUTE is checked when the call runs.
const FUNCTIONS_SQL = `
with
base_types as (
  with recursive recurse as (
    select oid, typbasetype, typnamespace as base_namespace, coalesce(nullif(typbasetype, 0), oid) as base_type from pg_type
    union
    select t.oid, b.typbasetype, b.typnamespace, coalesce(nullif(b.typbasetype, 0), b.oid)
    from recurse t join pg_type b on t.typbasetype = b.oid
  )
  select oid, base_namespace, base_type from recurse where typbasetype = 0
),
arguments as (
  select oid,
    array_agg(json_build_object(
      'name', coalesce(name, ''),
      'type', type::regtype::text,
      'typeMaxLength', case type
        when 'bit'::regtype then 'bit varying'
        when 'bit[]'::regtype then 'bit varying[]'
        when 'character'::regtype then 'character varying'
        when 'character[]'::regtype then 'character varying[]'
        else type::regtype::text end,
      'required', idx <= (pronargs - pronargdefaults),
      'variadic', coalesce(mode = 'v', false)
    ) order by idx) as args,
    case count(*) - count(name)
      when 0 then true
      when 1 then (array_agg(type))[1] in ('bytea'::regtype, 'json'::regtype, 'jsonb'::regtype, 'text'::regtype, 'xml'::regtype)
      else false
    end as callable
  from pg_proc, unnest(proargnames, proargtypes, proargmodes) with ordinality as _ (name, type, mode, idx)
  where type is not null
  group by oid
)
select p.proname as name,
  coalesce(a.args, '{}') as args,
  tn.nspname as ret_schema,
  coalesce(comp.relname, t.typname) as ret_name,
  p.proretset as returns_set,
  (t.typtype = 'c' or coalesce(proargmodes::text[] && '{t,b,o}', false)) as returns_composite,
  p.provolatile as volatility
from pg_proc p
left join arguments a on a.oid = p.oid
join pg_namespace pn on pn.oid = p.pronamespace
join base_types bt on bt.oid = p.prorettype
join pg_type t on t.oid = bt.base_type
join pg_namespace tn on tn.oid = t.typnamespace
left join pg_class comp on comp.oid = t.typrelid
where pn.nspname = $1 and t.oid <> 'trigger'::regtype and coalesce(a.callable, true) and p.prokind = 'f'`

// Role settings PostgREST applies when impersonating a role (Config/Database.hs):
// the role's own settings that a user may SET, except the isolation level.
const ROLE_SETTINGS_SQL = `
with kv as (
  select r.rolname, substr(setting, 1, strpos(setting, '=') - 1) as key, lower(substr(setting, strpos(setting, '=') + 1)) as value
  from pg_roles r, unnest(r.rolconfig) as setting
  where r.rolname = any($1)
)
select kv.rolname as role, kv.key, kv.value
from kv join pg_settings ps on ps.name = kv.key and ps.context = 'user'
where kv.key <> 'default_transaction_isolation'`

interface FunctionRow {
  name: string
  args: FunctionParam[] | string
  ret_schema: string
  ret_name: string
  returns_set: boolean
  returns_composite: boolean
  volatility: string
}

/**
 * `roles` are the impersonated roles plus the connector role (PostgREST's
 * login role, `authenticator` on Supabase): its settings — e.g. Supabase's
 * statement_timeout / lock_timeout — apply to every PostgREST session, so the
 * executor applies them first, then the impersonated role's.
 */
export async function introspect(db: Queryable, schema = 'public', roles: string[] = ['anon', 'authenticated', 'service_role', 'authenticator']): Promise<SchemaCache> {
  const [tables, keys, fks, fns, roleRows, bypassRows] = await Promise.all([
    db.query<{ name: string; kind: string; columns: Column[] }>(TABLES_SQL, [schema]),
    db.query<{ table: string; type: string; columns: string[] }>(KEYS_SQL, [schema]),
    db.query<{ name: string; table: string; ref_table: string; columns: string[]; ref_columns: string[] }>(FKS_SQL, [schema]),
    db.query<FunctionRow>(FUNCTIONS_SQL, [schema]),
    db.query<{ role: string; key: string; value: string }>(ROLE_SETTINGS_SQL, [roles]),
    db.query<{ role: string }>('select rolname as role from pg_roles where rolname = any($1) and not rolbypassrls', [roles]),
  ])

  const tableMap = new Map<string, Table>()
  for (const row of tables.rows) {
    const columns = typeof row.columns === 'string' ? (JSON.parse(row.columns) as Column[]) : row.columns
    tableMap.set(row.name, {
      schema,
      name: row.name,
      kind: row.kind,
      columns: new Map(columns.map((c) => [c.name, c])),
      columnOrder: columns.map((c) => c.name),
      primaryKey: [],
      uniqueKeys: [],
    })
  }
  for (const key of keys.rows) {
    const table = tableMap.get(key.table)
    if (!table) continue
    if (key.type === 'p') table.primaryKey = key.columns
    table.uniqueKeys.push(key.columns)
  }

  const functions = new Map<string, PgFunction[]>()
  for (const row of fns.rows) {
    const raw = (Array.isArray(row.args) ? row.args : JSON.parse(row.args as string)) as Array<FunctionParam | string>
    const params = raw.map((a) => (typeof a === 'string' ? (JSON.parse(a) as FunctionParam) : a))
    const fn: PgFunction = {
      schema,
      name: row.name,
      params,
      returnsSet: row.returns_set,
      returnsComposite: row.returns_composite,
      returnTypeName: row.ret_name,
      returnTypeSchema: row.ret_schema,
      volatility: row.volatility,
    }
    const list = functions.get(row.name) ?? []
    list.push(fn)
    functions.set(row.name, list)
  }
  // Fewest parameters first, like PostgREST's Ord Routine.
  for (const list of functions.values()) list.sort((a, b) => a.params.length - b.params.length)

  const roleSettings = new Map<string, Array<[string, string]>>()
  for (const row of roleRows.rows) {
    const list = roleSettings.get(row.role) ?? []
    list.push([row.key, row.value])
    roleSettings.set(row.role, list)
  }

  return {
    schema,
    tables: tableMap,
    foreignKeys: fks.rows.map((r) => ({ name: r.name, table: r.table, columns: r.columns, refTable: r.ref_table, refColumns: r.ref_columns })),
    functions,
    roleSettings,
    rolesWithoutBypassRls: new Set(bypassRows.rows.map((r) => r.role)),
  }
}

/**
 * Lazily loaded, refreshable schema cache. Like PostgREST's, it can go stale
 * after DDL: lookups that miss (unknown table, function, column or
 * relationship) reload it (at most once per cooldown), and a cache older
 * than `maxAgeMs` is reloaded in the background while still being served.
 */
export class SchemaStore {
  private current: SchemaCache | null = null
  private loading: Promise<SchemaCache> | null = null
  private lastLoad = 0

  constructor(
    private readonly load: () => Promise<SchemaCache>,
    private readonly maxAgeMs = 60_000,
    private readonly refreshCooldownMs = 2_000,
  ) {}

  async get(): Promise<SchemaCache> {
    if (this.current) {
      if (Date.now() - this.lastLoad > this.maxAgeMs) void this.reload().catch(() => undefined)
      return this.current
    }
    return this.reload()
  }

  reload(): Promise<SchemaCache> {
    if (!this.loading) {
      this.loading = this.load()
        .then((cache) => {
          this.current = cache
          this.lastLoad = Date.now()
          return cache
        })
        .finally(() => {
          this.loading = null
        })
    }
    return this.loading
  }

  /** Reload after a lookup miss, unless the cache is fresher than the cooldown. */
  async refreshAfterMiss(): Promise<SchemaCache | null> {
    if (Date.now() - this.lastLoad < this.refreshCooldownMs) return null
    return this.reload()
  }
}
