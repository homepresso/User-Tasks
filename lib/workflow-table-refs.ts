/**
 * Data-table references in workflow node configs.
 *
 * The canonical key is `config.table_id` (+ `table_name`, a cached display
 * name). Older imports, MCP/CLI authored workflows and hand-written JSON used
 * `tableId`, `data_table_id`, `dataTableId` or `custom_table_id`; those are
 * read as aliases and migrated to `table_id` when a workflow is opened.
 *
 * Display rule: a table is shown by its current name (from the tenant's
 * table list), then the cached `table_name`; never by its raw id. A bound id
 * that no longer exists reads "Unknown table (1a2b3c4d)".
 */

export const LEGACY_TABLE_ID_KEYS = ['tableId', 'data_table_id', 'dataTableId', 'custom_table_id'] as const
export const LEGACY_TABLE_NAME_KEYS = ['tableName', 'data_table_name', 'dataTableName'] as const

/** Node types whose config can bind a data table via `table_id`. */
export const DATA_TABLE_NODE_TYPES = ['update_data_table', 'data_table_event', 'server_event', 'retention_policies', 'doc_extract'] as const

/** id → name of the tenant's data tables. `undefined` = not loaded (yet). */
export type TableNames = Record<string, string>

type Config = Record<string, unknown> | null | undefined

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

/** The bound table id, whichever key it was stored under ('' when none). */
export function dataTableIdOf(config: Config): string {
  if (!config) return ''
  const direct = str(config.table_id)
  if (direct) return direct
  for (const key of LEGACY_TABLE_ID_KEYS) {
    const v = str(config[key])
    if (v) return v
  }
  const nested = config.table as { id?: unknown } | undefined
  return nested && typeof nested === 'object' ? str(nested.id) : ''
}

/** The cached display name, whichever key it was stored under ('' when none). */
export function cachedTableNameOf(config: Config): string {
  if (!config) return ''
  const direct = str(config.table_name)
  if (direct) return direct
  for (const key of LEGACY_TABLE_NAME_KEYS) {
    const v = str(config[key])
    if (v) return v
  }
  const nested = config.table as { name?: unknown } | undefined
  return nested && typeof nested === 'object' ? str(nested.name) : ''
}

export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8)
}

/**
 * Display name of the bound table, or null when none is bound (a bare cached
 * `table_name` still shows).
 *  - an expression (`{{table_id}}`) shows as written;
 *  - the live name from `names` wins (a renamed table shows its new name);
 *  - else the cached `table_name`;
 *  - names loaded but the id missing → "Unknown table (1a2b3c4d)";
 *  - names not available → "Data table (1a2b3c4d)".
 */
export function dataTableLabel(config: Config, names?: TableNames): string | null {
  const id = dataTableIdOf(config)
  if (!id) return cachedTableNameOf(config) || null
  if (id.includes('{{')) return id
  const live = names?.[id]
  if (live) return live
  const cached = cachedTableNameOf(config)
  if (cached) return cached
  return names ? `Unknown table (${shortId(id)})` : `Data table (${shortId(id)})`
}

/**
 * Migrate a legacy table key to `table_id` / `table_name` (on read). Returns
 * the same object when nothing changes, so unchanged workflows stay clean.
 */
export function normalizeDataTableConfig<T extends { type: string; config: Record<string, unknown> }>(node: T): T {
  const c = node.config
  if (!c || typeof c !== 'object') return node
  const hasLegacyId = LEGACY_TABLE_ID_KEYS.some((k) => k in c)
  const hasLegacyName = LEGACY_TABLE_NAME_KEYS.some((k) => k in c)
  if (!hasLegacyId && !hasLegacyName) return node
  const next: Record<string, unknown> = { ...c }
  const id = dataTableIdOf(c)
  const name = cachedTableNameOf(c)
  for (const k of [...LEGACY_TABLE_ID_KEYS, ...LEGACY_TABLE_NAME_KEYS]) delete next[k]
  if (id) next.table_id = id
  if (name && !str(c.table_name)) next.table_name = name
  return { ...node, config: next }
}

/** Normalise every node of a workflow; returns the same array when nothing changed. */
export function normalizeDataTableNodes<T extends { type: string; config: Record<string, unknown> }>(nodes: T[]): T[] {
  let changed = false
  const out = nodes.map((n) => {
    const m = normalizeDataTableConfig(n)
    if (m !== n) changed = true
    return m
  })
  return changed ? out : nodes
}

export interface PickerItem { id: string; name: string; subtitle?: string; archived?: boolean }

/**
 * What a record picker shows for `selectedId`: the matching item, else (a
 * bound id not in the list — still loading, deleted or out of scope) a
 * placeholder entry, so a bound value never renders as an empty picker.
 */
export function resolvePickerSelection(
  items: PickerItem[],
  selectedId: string,
  opts: { fallbackName?: string; loading?: boolean } = {},
): (PickerItem & { missing: boolean }) | null {
  if (!selectedId) return null
  const found = items.find((item) => item.id === selectedId)
  if (found) return { ...found, missing: false }
  return {
    id: selectedId,
    name: opts.fallbackName || (opts.loading ? 'Loading…' : `Unknown (${shortId(selectedId)})`),
    missing: !opts.loading,
  }
}
