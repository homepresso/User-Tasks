import { isObjectLike } from '@/lib/utils/guards'

/** Column list of a custom_tables row, normalized (client-safe: no server imports). */
export type TableColumn = {
  key: string
  label: string
  type: string
}

export function normalizeTableColumns(columns: unknown): TableColumn[] {
  if (Array.isArray(columns)) {
    return columns
      .filter((col) => isObjectLike(col) && (col.key || col.name || col.id))
      .map((col) => ({
        key: String((col as Record<string, unknown>).key ?? (col as Record<string, unknown>).name ?? (col as Record<string, unknown>).id),
        label: String((col as Record<string, unknown>).label ?? (col as Record<string, unknown>).name ?? (col as Record<string, unknown>).key ?? (col as Record<string, unknown>).id),
        type: String((col as Record<string, unknown>).type ?? 'text'),
      }))
  }

  if (isObjectLike(columns)) {
    return Object.entries(columns).map(([key, value]) => {
      if (typeof value === 'string') {
        return { key, label: value, type: 'text' }
      }
      if (isObjectLike(value)) {
        return {
          key,
          label: String(value.label ?? value.name ?? key),
          type: String(value.type ?? 'text'),
        }
      }
      return { key, label: key, type: 'text' }
    })
  }

  return []
}
