import { z } from 'zod'
import { getDb } from '../context'
import { getCellByIdentifier } from '@/lib/data-table-cells'
import type { LookupFilter, LookupOption } from '@/components/data/lookup-config'
import { check, defineRead, id, NO_ARGS, type UiRead } from './define'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/** Data store: table list, table detail + rows, lookup pickers and options, single row data. */

const RETENTION_POLICY_COLUMNS = 'id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to'

const lookupFilter = z.object({
  column: z.string().max(200),
  operator: z.enum(['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'is_empty', 'not_empty']),
  value: z.string().max(1000).optional(),
})

function matchesLookupFilter(rowData: Record<string, any>, filter: Omit<LookupFilter, 'id'>) {
  if (!filter.column) return true

  const rawValue = getCellByIdentifier(rowData, filter.column)
  const textValue = String(rawValue ?? '').toLowerCase()
  const compareValue = String(filter.value ?? '').toLowerCase()

  switch (filter.operator) {
    case 'equals':
      return textValue === compareValue
    case 'not_equals':
      return textValue !== compareValue
    case 'contains':
      return textValue.includes(compareValue)
    case 'starts_with':
      return textValue.startsWith(compareValue)
    case 'ends_with':
      return textValue.endsWith(compareValue)
    case 'is_empty':
      return rawValue == null || String(rawValue).trim() === ''
    case 'not_empty':
      return !(rawValue == null || String(rawValue).trim() === '')
    default:
      return true
  }
}

export const reads = {
  /** Tables with row counts and creator (data store list). */
  'data.tables': defineRead({
    args: NO_ARGS,
    perm: 'data.view',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('custom_tables')
        .select('*, row_count:custom_table_rows(count), creator:users!custom_tables_created_by_fkey(id, display_name, email, avatar_url)')
        .order('updated_at', { ascending: false })
      return (data ?? []) as any[]
    },
  }),

  'data.table': defineRead({
    args: z.object({ id }),
    perm: 'data.view',
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('custom_tables')
        .select(`*, retention_policy:retention_policies(${RETENTION_POLICY_COLUMNS}), creator:users!custom_tables_created_by_fkey(id, display_name, email, avatar_url)`)
        .eq('id', id)
        .maybeSingle()
      return (data ?? null) as any
    },
  }),

  /**
   * A table's rows, hydrated with retention policy and creator/updater.
   * Kept resilient: base rows first, then optional relations in follow-up
   * queries so one broken join or unapplied migration can't blank the grid.
   */
  'data.rows': defineRead({
    args: z.object({ tableId: id }),
    perm: 'data.view',
    run: async (ctx, { tableId }) => {
      const db = getDb(ctx) as any
      const { data: rawRows, error: rowsError } = await db.from('custom_table_rows')
        .select('*')
        .eq('table_id', tableId)
        .order('updated_at', { ascending: false, nullsFirst: false })

      if (rowsError) {
        console.error('[data/page] failed to load custom table rows', rowsError)
        return [] as any[]
      }

      const rows = (rawRows ?? []) as any[]
      if (rows.length === 0) return rows

      const policyIds = [...new Set(rows.map((row) => row.retention_policy_id).filter((value): value is string => !!value))]
      const userIds = [...new Set(
        rows.flatMap((row) => [row.created_by, row.updated_by]).filter((value): value is string => !!value),
      )]

      const [policies, users] = await Promise.all([
        policyIds.length > 0
          ? db.from('retention_policies').select(RETENTION_POLICY_COLUMNS).in('id', policyIds)
          : Promise.resolve({ data: [], error: null }),
        userIds.length > 0
          ? db.from('users').select('id, display_name, email, avatar_url').in('id', userIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      let policyMap = new Map<string, any>()
      if (policies.error) console.warn('[data/page] failed to hydrate row retention policies', policies.error)
      else policyMap = new Map((policies.data ?? []).map((policy: any) => [policy.id, policy]))

      let userMap = new Map<string, any>()
      if (users.error) console.warn('[data/page] failed to hydrate row creator/updater users', users.error)
      else userMap = new Map((users.data ?? []).map((user: any) => [user.id, user]))

      return rows.map((row) => ({
        ...row,
        retention_policy: row.retention_policy_id ? policyMap.get(row.retention_policy_id) ?? null : null,
        creator: row.created_by ? userMap.get(row.created_by) ?? null : null,
        updater: row.updated_by ? userMap.get(row.updated_by) ?? null : null,
      }))
    },
  }),

  /** Tables (with columns) a lookup column can point at (table designer). */
  'data.lookupTables': defineRead({
    args: NO_ARGS,
    perm: 'data.view',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('custom_tables').select('id, name, columns').order('name')
      return (data ?? []) as { id: string; name: string; columns: { id: string; name: string; type: string }[] }[]
    },
  }),

  /** A row's current data (merged with an uploaded file cell before saving). */
  'data.rowData': defineRead({
    args: z.object({ id }),
    perm: 'data.view',
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('custom_table_rows').select('data').eq('id', id).maybeSingle()
      return (data?.data ?? null) as Record<string, unknown> | null
    },
  }),

  /**
   * Options for a lookup column: the source table's rows filtered, sorted and
   * reduced to their source-column values here, so only the options travel.
   */
  'data.lookupOptions': defineRead({
    args: z.object({
      sourceTableId: id,
      sourceColumn: z.string().min(1).max(200),
      filters: z.array(lookupFilter).max(50).optional(),
      distinct: z.boolean().optional(),
      sortBy: z.string().max(200).optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
    }),
    perm: 'data.view',
    run: async (ctx, lookup): Promise<LookupOption[]> => {
      const rows = check(await (getDb(ctx) as any).from('custom_table_rows')
        .select('data')
        .eq('table_id', lookup.sourceTableId)) as Array<{ data: Record<string, any> | null }> | null

      let filteredRows = (rows ?? []).filter((row) => {
        const rowData = (row.data ?? {}) as Record<string, any>
        return (lookup.filters ?? []).every((filter) => matchesLookupFilter(rowData, filter))
      })

      const sortColumn = lookup.sortBy || lookup.sourceColumn
      filteredRows = filteredRows.sort((a, b) => {
        const left = String(getCellByIdentifier((a.data ?? {}) as Record<string, any>, sortColumn) ?? '')
        const right = String(getCellByIdentifier((b.data ?? {}) as Record<string, any>, sortColumn) ?? '')
        const compared = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
        return lookup.sortDir === 'desc' ? -compared : compared
      })

      const options = filteredRows
        .map((row) => {
          const rawValue = getCellByIdentifier((row.data ?? {}) as Record<string, any>, lookup.sourceColumn)
          const label = rawValue == null ? '' : String(rawValue)
          return { value: label, label }
        })
        .filter((option) => option.value.trim() !== '')

      if (!lookup.distinct) return options

      const seen = new Set<string>()
      return options.filter((option) => {
        const key = option.value.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    },
  }),
} satisfies Record<string, UiRead<any, any>>
