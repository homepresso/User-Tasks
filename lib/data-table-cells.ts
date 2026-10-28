/**
 * Canonical cell access for custom data table rows.
 *
 * Row `data` is a single jsonb blob and the codebase historically wrote it
 * with two different key conventions: the data grid / row drawer keyed cells
 * by column display NAME ("Order No") while the workflow engine, MCP tools,
 * and agent data tool key by column KEY ("order_no"). Rows written by one
 * side rendered blank on the other.
 *
 * The canonical key is `column.key` (falling back to a slug of the name for
 * legacy columns that were created without one). Reads tolerate all legacy
 * spellings; writes always use the canonical key so mixed rows converge the
 * next time they're edited.
 */

export interface CellColumn {
  key?: string
  name: string
}

export function slugifyColumnName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** Canonical data key for a column: explicit key, else slug of the name. */
export function columnKey(col: CellColumn): string {
  return col.key || slugifyColumnName(col.name)
}

/**
 * Read a cell value: canonical key first, then display name (legacy rows),
 * then a slug-insensitive scan so "Order No" / "order_no" / "orderNo" all
 * resolve to the same cell.
 */
export function getCellValue(data: Record<string, any> | null | undefined, col: CellColumn): any {
  if (!data) return undefined
  const key = columnKey(col)
  if (key in data) return data[key]
  if (col.name && col.name in data) return data[col.name]
  const slug = slugifyColumnName(col.name || key)
  for (const [k, v] of Object.entries(data)) {
    if (slugifyColumnName(k) === slug) return v
  }
  return undefined
}

/**
 * Read a cell by a stored column identifier (name or key) when no column
 * object is available — e.g. lookup configs that saved a column name.
 */
export function getCellByIdentifier(data: Record<string, any> | null | undefined, identifier: string): any {
  if (!data || !identifier) return undefined
  if (identifier in data) return data[identifier]
  const slug = slugifyColumnName(identifier)
  for (const [k, v] of Object.entries(data)) {
    if (slugifyColumnName(k) === slug) return v
  }
  return undefined
}

/**
 * Rewrite row data onto canonical column keys, preserving any entries that
 * don't belong to a known column (system fields like "Date Created", stale
 * columns, engine bookkeeping). Used when the grid starts an edit so the
 * subsequent save migrates legacy name-keyed rows in place.
 */
export function normalizeRowData(
  data: Record<string, any> | null | undefined,
  columns: CellColumn[],
): Record<string, any> {
  const source = { ...(data ?? {}) }
  const result: Record<string, any> = {}
  for (const col of columns) {
    const key = columnKey(col)
    const value = getCellValue(source, col)
    if (value !== undefined) result[key] = value
    // Consume every spelling of this column so it can't reappear below.
    delete source[key]
    if (col.name) delete source[col.name]
    const slug = slugifyColumnName(col.name || key)
    for (const k of Object.keys(source)) {
      if (slugifyColumnName(k) === slug) delete source[k]
    }
  }
  // Whatever is left doesn't map to a known column — keep it untouched.
  return { ...source, ...result }
}
