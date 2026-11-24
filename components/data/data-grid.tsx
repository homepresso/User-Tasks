'use client'

import { ExtensionToolbarActions } from '@/components/extensions/item-actions'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { insertRow, deleteRow } from '@/app/actions/data-store'
import { getGridViews, gridOptions, saveGridViews, writeGridCells, writeGridRows } from '@/app/actions/data-grid'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { InlineNotice } from '@/components/ui/inline-notice'
import { TableEmpty, tdClass, thClass, trClass } from '@/components/ui/table'
import {
  Plus, Trash2, Upload, FileText, ExternalLink, Loader2, Check, X,
  PanelRightOpen, ArrowUp, ArrowDown, Type, Hash, Calendar, ToggleLeft,
  List, Paperclip, AlignLeft, Link2, Columns3, Lock, Settings2, ChevronLeft, ChevronRight, PencilLine, ChevronDown, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { RowDetailDrawer, uploadRowFile } from './row-detail-drawer'
import { AddRowSheet } from './add-row-sheet'
import { GridViewSettings } from './grid-view-settings'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'
import { serverRead, serverQuery } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import type { DataColumn } from './lookup-config'
import { columnKey, getCellValue } from '@/lib/data-table-cells'
import { useLookupOptions } from './use-lookup-options'
import { GridSurfaceProvider, GridLabelsProvider, usePageLabels, type GridSurface } from '@/components/grid/grid-context'
import { GridCellEditor, editorFloats } from '@/components/grid/cell-editor'
import { GridCellDisplay } from '@/components/grid/cell-display'
import { expectedVersion, optimisticRow, settleSave, type SaveAnswer } from '@/lib/grid/inline-save'
import {
  GRID_LIMITS, coerceGridValue, dependentColumns, isColumnEditable, isMultiValue, pickView, schemaColumns, type GridColumnDef, type GridViewConfig,
} from '@/lib/grid/column-model'
import {
  applyBatchResult, buildBatch, canUndo, cellValue, changedRowCount, errorCount, hasChanges, inRange, isCellChanged,
  registerRows, removeAddedRow, resolveConflict, type BatchSaveResult,
} from '@/lib/grid/edit-all'
import { normalizePeopleValue } from '@/lib/forms/people-field'
import { useEditAll } from '@/components/grid/use-edit-all'
import { EDIT_ALL_CHANGED_WASH, EDIT_ALL_FIELD, EDIT_ALL_READONLY, EditAllBar } from '@/components/grid/edit-all-bar'
import { useLeaveGuard } from '@/hooks/use-leave-guard'
import { ChildRecords, ChildToggle, type ChildExpandState, type RelationWithName } from './child-records'
import {
  GROUPABLE_TYPES, GROUPING_LIMITS, expandStateKey, groupFilters, groupId, groupLabel, normalizeGroupBy, parseExpandState, rootsOnlyFilter,
  type ChildRelation, type GroupNode,
} from '@/lib/grid/grouping'

/** A line of a grouped grid: a group header, a row, or a group's "show more" / loading line. */
type GroupItem =
  | { kind: 'group'; id: string; path: Array<string | null>; level: number; node: GroupNode; open: boolean }
  | { kind: 'row'; row: DataRow }
  | { kind: 'more'; id: string; shown: number; total: number; level: number }
  | { kind: 'loading'; id: string; level: number }

/** Leaf groups "Expand all" opens at most (each loads its rows). */
const EXPAND_ALL_LEAVES = 50

interface UserRef {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
}

interface DataRow {
  id: string
  table_id: string
  tenant_id: string
  data: Record<string, any>
  retention_policy_id?: string | null
  retention_applied_at?: string | null
  retention_policy?: {
    id: string
    name: string
    description?: string | null
    policy_mode: 'review' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
    duration_value?: number | null
    duration_unit?: 'days' | 'months' | 'years' | null
    exact_date?: string | null
    applies_to?: string[] | null
  } | null
  created_at: string
  updated_at?: string | null
  created_by?: string | null
  updated_by?: string | null
  creator?: UserRef | null
  updater?: UserRef | null
}

interface DataGridProps {
  tableId: string
  tenantId: string
  columns: DataColumn[]
  /** The table's row count as the grid pages it (the page header shows it). */
  onTotal?: (total: number) => void
}

/** 14px muted type icon in the column header. */
export const COLUMN_TYPE_ICON: Record<DataColumn['type'], typeof Type> = {
  text: Type,
  longtext: AlignLeft,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
  select: List,
  file: Paperclip,
  lookup: Link2,
}

/** Sticky left columns: the selection checkbox (40px) and the row ID. */
const STICKY_SELECT = 'sticky left-0 z-[2] w-10 min-w-10 pl-3 pr-0'
const STICKY_ID = 'sticky left-10 z-[2] w-24 min-w-24'
/** A stable empty people list (a fresh [] each render would rebuild the surface and loop the label effect). */
const NO_PEOPLE: Array<{ id: string; display_name: string | null; email: string | null }> = []
/** Row height the windowing assumes (a one-line cell). */
const ROW_HEIGHT = 41
/** Rows drawn above / below the visible window. */
const OVERSCAN = 12
/** Window the rows from this many on (fewer: all rows are drawn). */
const WINDOW_FROM = 80

/** True when the key event comes from a text field (shortcuts must not fire). */
function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

const numericControl = (col: GridColumnDef) => col.control === 'number' || col.control === 'currency' || (col.control === 'display' && Boolean(col.control_options?.formula))

/**
 * The Data section's table grid. Rows come a page at a time from the server
 * (data.rowPage: exact totals for plain pages; search / cell sorts scan the
 * newest rows) and are windowed when many are on a page. What the grid
 * shows is a VIEW (custom_tables.views — the shared grid engine,
 * lib/grid/column-model.ts): the columns, each cell's control (dropdown,
 * autocomplete bound to a table or an API reference, signature pad, people,
 * currency…) and, when the view allows inline editing, spreadsheet editing
 * of every row: arrows / Tab / Enter / Escape, one cell saved at a time with
 * an optimistic update rolled back on error, a friendly conflict when
 * someone else changed the row (updated_at check), read-only columns locked
 * (and refused by the server), saves and errors announced to screen readers.
 */
export function DataGrid({ tableId, tenantId, columns, onTotal }: DataGridProps) {
  const jobs = useJobs()
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const refreshRows = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['custom-table-rows', tableId] })
    queryClient.invalidateQueries({ queryKey: ['binding-table', tableId] })
    queryClient.invalidateQueries({ queryKey: ['data-child-counts'] })
  }, [queryClient, tableId])
  const { userId } = usePermissions()
  const [newRow, setNewRow] = useState<Record<string, any>>({})
  const [inlineAdd, setInlineAdd] = useState(false)
  const [sheetAdd, setSheetAdd] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [scroll, setScroll] = useState({ left: false, right: false, top: 0, height: 600 })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ row: string; col: string } | null>(null)
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<{ tone: 'danger' | 'warning'; message: string } | null>(null)
  const [announce, setAnnounce] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLTableElement>(null)
  const router = useRouter()
  const addRowGuard = useSubmitGuard()

  // Views (custom_tables.views): none saved, or the migration not applied yet → the built-in "All columns" view.
  const tableColumns = useMemo(() => schemaColumns(columns), [columns])
  const { data: viewData } = useQuery({
    queryKey: ['data-grid-views', tableId],
    staleTime: 30_000,
    queryFn: async () => { const res = await getGridViews(tableId); return res.ok ? res.data.views : [] as GridViewConfig[] },
  })
  const views = useMemo(() => viewData ?? [], [viewData])
  useEffect(() => {
    try { const saved = localStorage.getItem(`ut-data-view:${tableId}`); if (saved) setViewId(saved) } catch { /* private mode */ }
  }, [tableId])
  const view = useMemo(() => pickView(views, viewId, tableColumns), [views, viewId, tableColumns])
  const chooseView = (id: string) => {
    setViewId(id); setPage(1); setEditing(null); setGroupOverride(null)
    if (ea.current()) ea.stop()
    try { localStorage.setItem(`ut-data-view:${tableId}`, id) } catch { /* private mode */ }
  }
  const gridCols = useMemo(() => view.columns.filter((c) => !c.hidden), [view])
  const pageSize = view.page_size ?? GRID_LIMITS.defaultPageSize
  const saved = view.id !== 'default'
  const inline = saved && view.inline_edit === true && can('data.manage_rows')
  const canAdd = can('data.manage_rows') && (!saved || view.allow_add === true)
  const canDelete = can('data.manage_rows') && (!saved || view.allow_delete === true)

  /* ── Grouping (lib/grid/grouping.ts): by up to two columns, counted over the whole filtered result on the server ── */
  const [groupOverride, setGroupOverride] = useState<string[] | null>(null)
  const groupableCols = useMemo(() => tableColumns.filter((c) => GROUPABLE_TYPES.has(c.type)), [tableColumns])
  const groupBy = useMemo(() => normalizeGroupBy(groupOverride ?? view.group_by ?? [], new Set(groupableCols.map((c) => c.key))), [groupOverride, view.group_by, groupableCols])
  const groupKey = groupBy.join(',')
  const grouped = groupBy.length > 0
  const [groupNotice, setGroupNotice] = useState<string | null>(null)

  // Child records (custom_tables.child_relations): a same-table hierarchy may list only its top-level rows.
  const { data: relationData } = useQuery({
    queryKey: ['data-child-relations', tableId],
    staleTime: 30_000,
    queryFn: async () => ((await serverRead('data.childRelations', { tableId })).data ?? { relations: [], available: false }) as { relations: ChildRelation[]; available: boolean },
  })
  const rootFilters = useMemo(() => rootsOnlyFilter(relationData?.relations ?? [], tableId, columns), [relationData, tableId, columns])
  const rootKey = JSON.stringify(rootFilters)

  // Expand / collapse state, per user per view (localStorage).
  const groupStateKey = expandStateKey('groups', tableId, view.id, userId)
  const childStateKey = expandStateKey('children', tableId, view.id, userId)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [openChildren, setOpenChildren] = useState<Set<string>>(new Set())
  useEffect(() => {
    try { setOpenGroups(new Set(parseExpandState(localStorage.getItem(groupStateKey)))) } catch { setOpenGroups(new Set()) }
  }, [groupStateKey])
  useEffect(() => {
    try { setOpenChildren(new Set(parseExpandState(localStorage.getItem(childStateKey)))) } catch { setOpenChildren(new Set()) }
  }, [childStateKey])
  const persistGroups = useCallback((next: Set<string>) => {
    setOpenGroups(next)
    try { localStorage.setItem(groupStateKey, JSON.stringify([...next].slice(-500))) } catch { /* private mode */ }
  }, [groupStateKey])
  const childExpand = useMemo<ChildExpandState>(() => ({
    isOpen: (key) => openChildren.has(key),
    toggle: (key) => setOpenChildren((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      try { localStorage.setItem(childStateKey, JSON.stringify([...next].slice(-500))) } catch { /* private mode */ }
      return next
    }),
  }), [openChildren, childStateKey])

  // Rows: one page from the server (search debounced).
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchText.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [searchText])
  const { data: pageData, isFetching: pageFetching } = useQuery({
    queryKey: ['custom-table-rows', tableId, page, pageSize, search, sortCol, sortDir, rootKey],
    enabled: !grouped,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await serverRead('data.rowPage', { tableId, limit: pageSize, offset: (page - 1) * pageSize, search: search || undefined, sort: sortCol ?? undefined, dir: sortCol ? sortDir : undefined, filters: rootFilters.length ? rootFilters : undefined })
      if (error) throw new Error(error.message)
      return data as { rows: DataRow[]; total: number; truncated: boolean }
    },
  })

  // Grouped: the group tree (counts, sums) for the whole filtered result, then the rows of each open group.
  const sumCols = useMemo(() => gridCols.filter((c) => (c.control === 'number' || c.control === 'currency') && !c.control_options?.formula).map((c) => c.key).slice(0, GROUPING_LIMITS.sums), [gridCols])
  const groupDirection = sortCol && groupBy.includes(sortCol) ? groupBy.map((k) => (k === sortCol ? sortDir : 'asc')) : undefined
  const { data: groupData, isFetching: groupsFetching } = useQuery({
    queryKey: ['custom-table-rows', tableId, 'groups', groupKey, search, sumCols.join(','), groupDirection?.join(',') ?? '', rootKey],
    enabled: grouped,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await serverRead('data.rowGroups', { tableId, groupBy, search: search || undefined, sum: sumCols, direction: groupDirection, filters: rootFilters.length ? rootFilters : undefined })
      if (error) throw new Error(error.message)
      return { ...(data as { groups: GroupNode[]; total: number; exact: boolean; truncated: boolean; groups_truncated: boolean }), key: groupKey }
    },
  })
  const tree = useMemo(() => (grouped && groupData?.key === groupKey ? groupData.groups : []), [grouped, groupData, groupKey])
  const gid = useCallback((path: Array<string | null>) => `${groupKey}|${groupId(path)}`, [groupKey])
  const openLeaves = useMemo(() => {
    const out: Array<Array<string | null>> = []
    for (const g of tree) {
      if (!openGroups.has(gid([g.value]))) continue
      if (groupBy.length > 1) { for (const sub of g.groups ?? []) if (openGroups.has(gid([g.value, sub.value]))) out.push([g.value, sub.value]) }
      else out.push([g.value])
    }
    return out
  }, [tree, openGroups, gid, groupBy.length])
  const [groupLimits, setGroupLimits] = useState<Record<string, number>>({})
  const groupQueries = useQueries({
    queries: openLeaves.map((path) => {
      const id = gid(path)
      const limit = Math.min(GRID_LIMITS.pageSize, groupLimits[id] ?? pageSize)
      return {
        queryKey: ['custom-table-rows', tableId, 'group', id, limit, search, sortCol, sortDir, rootKey],
        placeholderData: (prev: unknown) => prev,
        queryFn: async () => {
          const { data, error } = await serverRead('data.rowPage', { tableId, limit, offset: 0, search: search || undefined, sort: sortCol ?? undefined, dir: sortCol ? sortDir : undefined, filters: [...rootFilters, ...groupFilters(groupBy, path)] })
          if (error) throw new Error(error.message)
          return data as { rows: DataRow[]; total: number; truncated: boolean }
        },
      }
    }),
  })
  const groupRowsSig = openLeaves.map((p, i) => `${gid(p)}@${groupQueries[i]?.dataUpdatedAt ?? 0}`).join(',')
  const groupRowsByLeaf = useMemo(() => {
    const map = new Map<string, { rows: DataRow[]; loading: boolean }>()
    openLeaves.forEach((p, i) => map.set(gid(p), { rows: (groupQueries[i]?.data as { rows: DataRow[] } | undefined)?.rows ?? [], loading: !groupQueries[i]?.data }))
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps -- groupQueries is a new array each render; groupRowsSig tracks its data
  }, [groupRowsSig])
  const isFetching = grouped ? groupsFetching || groupQueries.some((q) => q.isFetching) : pageFetching

  const [localRows, setLocalRows] = useState<DataRow[]>([])
  useEffect(() => {
    if (grouped) setLocalRows(openLeaves.flatMap((p) => groupRowsByLeaf.get(gid(p))?.rows ?? []))
    else setLocalRows(pageData?.rows ?? [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- openLeaves / gid change with groupRowsByLeaf
  }, [grouped, pageData, groupRowsByLeaf])
  const total = grouped ? groupData?.total ?? 0 : pageData?.total ?? 0
  useEffect(() => {
    // (A hierarchy listing only its top-level rows reports those.)
    if (search) return
    if (!grouped && pageData) onTotal?.(pageData.total)
    if (grouped && groupData?.exact) onTotal?.(groupData.total)
  }, [pageData, groupData, grouped, search, onTotal])
  const pages = Math.max(1, Math.ceil(total / pageSize))

  // Child counts of the loaded rows, per relation (one read).
  const { data: childInfo } = useQuery({
    queryKey: ['data-child-counts', tableId, localRows.map((r) => r.id).join(',')],
    enabled: (relationData?.relations.length ?? 0) > 0 && localRows.length > 0,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async () => ((await serverRead('data.childCounts', { tableId, rowIds: localRows.map((r) => r.id).slice(0, GROUPING_LIMITS.countParents) })).data ?? { relations: [], counts: {} }) as { relations: RelationWithName[]; counts: Record<string, Record<string, number>> },
  })
  const childRels = useMemo(() => childInfo?.relations ?? [], [childInfo])
  const hasChildren = childRels.length > 0

  function toggleGroup(id: string) {
    const next = new Set(openGroups)
    if (next.has(id)) next.delete(id); else next.add(id)
    persistGroups(next)
  }
  function expandAllGroups() {
    const next = new Set<string>()
    let leaves = 0
    for (const g of tree) {
      if (leaves >= EXPAND_ALL_LEAVES) break
      next.add(gid([g.value]))
      if (groupBy.length > 1) {
        for (const sub of g.groups ?? []) { if (leaves >= EXPAND_ALL_LEAVES) break; next.add(gid([g.value, sub.value])); leaves++ }
      } else leaves++
    }
    persistGroups(next)
    const totalLeaves = groupBy.length > 1 ? tree.reduce((n, g) => n + (g.groups?.length ?? 0), 0) : tree.length
    setGroupNotice(totalLeaves > EXPAND_ALL_LEAVES ? `Opened the first ${EXPAND_ALL_LEAVES} of ${totalLeaves} groups — open the others one at a time, or search to narrow them.` : null)
  }
  function collapseAllGroups() { persistGroups(new Set()); setGroupNotice(null) }
  function chooseGroupBy(level: number, key: string) {
    const next = [...groupBy]
    if (key) next[level] = key
    else next.splice(level)
    setGroupOverride(next.filter(Boolean).filter((k, i, a) => a.indexOf(k) === i))
    setGroupLimits({})
    setPage(1)
  }
  const groupingChanged = groupOverride !== null && groupKey !== (normalizeGroupBy(view.group_by ?? []).join(','))
  async function saveGroupingToView() {
    const next = views.map((v) => (v.id === view.id ? { ...v, group_by: groupBy.length ? groupBy : undefined } : v))
    const res = await saveGridViews(tableId, next)
    if (!res.ok) { setNotice({ tone: 'danger', message: res.error }); return }
    queryClient.setQueryData(['data-grid-views', tableId], res.data.views)
    setGroupOverride(null)
    setAnnounce('Grouping saved to the view')
  }
  const colByKeyAll = useMemo(() => new Map(gridCols.map((c) => [c.key, c])), [gridCols])
  function formatSum(key: string, value: number) {
    const col = colByKeyAll.get(key)
    if (col?.control === 'currency') {
      try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: col.control_options?.currency || 'USD' }).format(value) } catch { /* unknown code */ }
    }
    return value.toLocaleString('en-US', { maximumFractionDigits: col?.control_options?.decimals ?? 2 })
  }

  // The lines of a grouped grid, in order (rows in the same order as localRows).
  const groupItems = useMemo<GroupItem[]>(() => {
    if (!grouped) return []
    const items: GroupItem[] = []
    const leaf = (path: Array<string | null>, node: GroupNode, level: number) => {
      const id = gid(path)
      const entry = groupRowsByLeaf.get(id)
      if (!entry || entry.loading) { items.push({ kind: 'loading', id, level }); return }
      for (const row of entry.rows) items.push({ kind: 'row', row })
      if (entry.rows.length < node.count) items.push({ kind: 'more', id, shown: entry.rows.length, total: node.count, level })
    }
    for (const g of tree) {
      const id = gid([g.value])
      const open = openGroups.has(id)
      items.push({ kind: 'group', id, path: [g.value], level: 0, node: g, open })
      if (!open) continue
      if (groupBy.length > 1) {
        for (const sub of g.groups ?? []) {
          const subId = gid([g.value, sub.value])
          const subOpen = openGroups.has(subId)
          items.push({ kind: 'group', id: subId, path: [g.value, sub.value], level: 1, node: sub, open: subOpen })
          if (subOpen) leaf([g.value, sub.value], sub, 1)
        }
      } else leaf([g.value], g, 0)
    }
    return items
  }, [grouped, tree, openGroups, gid, groupBy.length, groupRowsByLeaf])


  // People (people cells) — only when the view has one.
  const { data: people = NO_PEOPLE } = useQuery({
    queryKey: ['data-grid-people'],
    enabled: gridCols.some((c) => c.control === 'people'),
    staleTime: 60_000,
    queryFn: async () => ((await serverRead('tasks.redirectUsers')).data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>,
  })
  const surface = useMemo<GridSurface>(() => ({
    scope: `grid:${tableId}:${view.id}`,
    fetchOptions: async (req) => {
      const res = await gridOptions(tableId, view.id, { column: req.column, query: req.query, resolve: req.resolve, row: req.row })
      if (!res.ok) throw new Error(res.error)
      return res.data
    },
    upload: can('data.manage_rows') ? async (file, name) => uploadRowFile(tableId, file instanceof File ? file : new File([file], name, { type: file.type || 'image/png' })) : undefined,
    people,
  }), [tableId, view.id, people, can])
  const labels = usePageLabels(gridCols, useMemo(() => localRows.map((r) => r.data ?? {}), [localRows]), surface)

  /* ── Edit all rows (lib/grid/edit-all.ts): every row's cells editable at once, saved as one batch ── */
  const [batchSaving, setBatchSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const colByKey = useMemo(() => new Map(gridCols.map((c) => [c.key, c])), [gridCols])
  const baseOf = useCallback((row: DataRow) => {
    const values: Record<string, unknown> = { ...(row.data ?? {}) }
    for (const col of gridCols) values[col.key] = getCellValue(row.data ?? {}, { key: col.key, name: col.label }) ?? null
    return values
  }, [gridCols])
  const editAllCanEdit = (row: string, colKey: string) => {
    const col = colByKey.get(colKey)
    if (!col || !inline || !isColumnEditable(col) || ['id', 'date_created'].includes(col.key)) return false
    return !ea.session?.locked[row]
  }
  const ea = useEditAll({
    rowKeys: localRows.map((r) => r.id),
    colKeys: gridCols.map((c) => c.key),
    canEdit: editAllCanEdit,
    isBoolean: (k) => colByKey.get(k)?.control === 'boolean',
    pasteColumn: (k) => {
      const col = colByKey.get(k)!
      return { key: col.key, label: col.label, control: col.control, choices: col.control_options?.choices, multiple: isMultiValue(col), bound: Boolean(col.binding) }
    },
    coerce: (k, raw) => coerceGridValue(colByKey.get(k)!, raw),
    dependents: (k) => dependentColumns(view.columns, k),
    allowAdd: canAdd,
    blankRow: () => Object.fromEntries(gridCols.filter((c) => c.control === 'boolean' && isColumnEditable(c)).map((c) => [c.key, false])),
    people,
    focusDom: (r, c) => focusCell(r, c),
    onSave: () => { void saveAll() },
    announce: setAnnounce,
    copyText: (k, v) => {
      const col = colByKey.get(k)
      if (v === null || v === undefined) return ''
      if (col?.control === 'people') return normalizePeopleValue(v).map((p) => p.name ?? p.id).join(', ')
      if (col?.control === 'boolean') return v === true ? 'TRUE' : 'FALSE'
      if (Array.isArray(v)) return v.join(', ')
      if (typeof v === 'object') return (v as { name?: string }).name ?? ''
      return String(v)
    },
  })
  const session = ea.session
  const dirty = Boolean(session && hasChanges(session))
  const startEditAll = useCallback(() => {
    if (!inline) return
    setEditing(null)
    ea.start(localRows.map((r) => ({ key: r.id, values: baseOf(r), version: expectedVersion(r) })))
    setAnnounce('Editing all rows. Arrow keys move, type to edit, Escape reverts a cell, Control or Command S saves.')
    const first = gridCols.findIndex((c) => isColumnEditable(c) && !['id', 'date_created'].includes(c.key))
    requestAnimationFrame(() => focusCell(0, Math.max(0, first)))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ea / focusCell are per-render helpers
  }, [inline, localRows, baseOf, gridCols])
  // Rows of the next page / a refresh join the session (drafts are kept per row across pages).
  useEffect(() => {
    const s = ea.current()
    if (!s) return
    const next = registerRows(s, localRows.map((r) => ({ key: r.id, values: baseOf(r), version: expectedVersion(r) })))
    if (next !== s) ea.set(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ea is a per-render helper
  }, [localRows, baseOf])
  // "Always open in edit mode" (per view).
  const autoOpened = useRef<string | null>(null)
  useEffect(() => {
    if (!inline || !view.open_in_edit_mode || !pageData || session || autoOpened.current === view.id) return
    autoOpened.current = view.id
    startEditAll()
  }, [inline, view.open_in_edit_mode, view.id, pageData, session, startEditAll])
  // Leaving with unsaved changes asks first (in-app links; reload / close: the browser's prompt).
  const leaveGuard = useLeaveGuard(dirty)
  useEffect(() => {
    if (!dirty) return
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [dirty])

  async function saveAll() {
    const s = ea.current()
    if (!s || batchSaving) return
    if (!hasChanges(s)) { setAnnounce('No changes to save'); return }
    const batch = buildBatch(s)
    setBatchSaving(true)
    setAnnounce(`Saving ${plural(changedRowCount(s), 'row')}…`)
    const res = await writeGridRows(tableId, { view_id: view.id, rows: batch.rows, inserts: batch.inserts })
    setBatchSaving(false)
    if (!res.ok) { setNotice({ tone: 'danger', message: res.error }); setAnnounce(`Not saved: ${res.error}`); return }
    const latest = ea.current() ?? s
    const outcome = applyBatchResult(latest, res.data as unknown as BatchSaveResult)
    // The grid shows the saved rows as the server returned them.
    const savedRows = new Map(res.data.rows.filter((r) => r.status === 'saved' || r.status === 'unchanged').map((r) => [r.row_id, (r as { row: Record<string, unknown> }).row]))
    setLocalRows((rows) => rows.map((r) => {
      const server = savedRows.get(r.id) as Partial<DataRow> | undefined
      return server ? { ...r, data: (server.data as DataRow['data'] | undefined) ?? r.data, updated_at: server.updated_at ?? r.updated_at, updated_by: server.updated_by ?? r.updated_by } : r
    }))
    if (outcome.inserted.length || grouped) refreshRows()
    const left = hasChanges(outcome.state) || errorCount(outcome.state) > 0 || Object.keys(outcome.state.conflicts).length > 0
    const parts = [`Saved ${plural(outcome.saved, 'row')}`]
    if (outcome.failed) parts.push(`${plural(outcome.failed, 'row')} not saved — see the marked cells`)
    if (outcome.conflicts) parts.push(`${plural(outcome.conflicts, 'row')} changed by someone else — keep yours or take theirs`)
    setAnnounce(parts.join('; '))
    if (outcome.failed || outcome.conflicts) setNotice({ tone: 'warning', message: parts.join('; ') })
    else setNotice(null)
    if (!left && !view.open_in_edit_mode) ea.stop()
    else ea.set(left ? outcome.state : { ...outcome.state, undo: [] })
  }

  function cancelEditAll() {
    if (dirty) { setConfirmDiscard(true); return }
    ea.stop()
  }

  // Shift+N toggles the inline "new row" entry under the header (the button opens the Sheet).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'N' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)) {
        e.preventDefault()
        setInlineAdd((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ⇧E opens "Edit all rows"; while editing, Ctrl/Cmd+S saves wherever focus is.
  const startRef = useRef(startEditAll)
  startRef.current = startEditAll
  const saveRef = useRef(saveAll)
  saveRef.current = saveAll
  const editAllOn = Boolean(session)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'E' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e) && inline && !editAllOn) { e.preventDefault(); startRef.current() }
      else if (editAllOn && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inline, editAllOn])

  // Horizontal scroll shadows and the vertical window.
  const updateScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const left = el.scrollLeft > 0
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    const top = el.scrollTop
    const height = el.clientHeight
    setScroll((s) => (s.left === left && s.right === right && Math.abs(s.top - top) < ROW_HEIGHT / 2 && s.height === height ? s : { left, right, top, height }))
  }, [])
  useEffect(() => {
    updateScroll()
    window.addEventListener('resize', updateScroll)
    return () => window.removeEventListener('resize', updateScroll)
  }, [updateScroll, gridCols.length, localRows.length])

  const detailRow = useMemo(() => localRows.find(r => r.id === detailRowId) ?? null, [localRows, detailRowId])

  const allRowIds = localRows.map(r => r.id)
  const allSelected = allRowIds.length > 0 && allRowIds.every(id => selectedRows.has(id))
  const someSelected = !allSelected && allRowIds.some(id => selectedRows.has(id))

  function toggleRow(id: string) {
    setSelectedRows(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  function toggleAll() {
    if (allSelected) setSelectedRows(new Set())
    else setSelectedRows(new Set(allRowIds))
  }

  async function deleteSelected() {
    setDeleting(true)
    const ids = Array.from(selectedRows)
    const previous = localRows
    setLocalRows((current) => current.filter((row) => !selectedRows.has(row.id)))
    setSelectedRows(new Set())
    setConfirmBulk(false)
    if (detailRowId && ids.includes(detailRowId)) setDetailRowId(null)
    try {
      await bulkDeleteWithJob(jobs, 'data_row', ids, () => refreshRows())
    } catch (e: any) {
      setLocalRows(previous)
      setSelectedRows(new Set(ids))
      setNotice({ tone: 'danger', message: `Failed to delete rows: ${e.message}` })
    }
    setDeleting(false)
  }

  async function handleAddRow() {
    await addRowGuard.run(async () => {
      try {
        await insertRow(tableId, tenantId, newRow)
        setNewRow({})
        refreshRows()
        router.refresh()
      } catch (e: any) {
        setNotice({ tone: 'danger', message: `Failed to add row: ${e.message}` })
      }
    })
  }

  async function handleDelete(rowId: string) {
    setPendingDelete(null)
    const previous = localRows
    setLocalRows((current) => current.filter((row) => row.id !== rowId))
    setSelectedRows((current) => { const next = new Set(current); next.delete(rowId); return next })
    if (detailRowId === rowId) setDetailRowId(null)
    try {
      await deleteRow(rowId)
      refreshRows()
      router.refresh()
    } catch (e: any) {
      setLocalRows(previous)
      setNotice({ tone: 'danger', message: `Failed to delete row: ${e.message}` })
    }
  }

  async function uploadNewRowFile(file: File, colKey: string) {
    setUploading(colKey)
    try {
      const fileData = await uploadRowFile(tableId, file)
      setNewRow(prev => ({ ...prev, [colKey]: fileData }))
    } catch (e: any) {
      setNotice({ tone: 'danger', message: `Upload failed: ${e.message}` })
    }
    setUploading(null)
  }

  function copyId(id: string) {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500)
  }

  /* ── Inline editing: per-cell autosave, optimistic, rolled back on error ── */

  async function saveCell(row: DataRow, col: GridColumnDef, value: unknown) {
    const errKey = `${row.id}:${col.key}`
    const cleared = Object.fromEntries(dependentColumns(view.columns, col.key).map((k) => [k, null]))
    const cells = { ...cleared, [col.key]: value }
    const previous = row
    setCellErrors((e) => { const n = { ...e }; delete n[errKey]; return n })
    setLocalRows((rs) => rs.map((r) => (r.id === row.id ? optimisticRow(r, cells) : r)))
    setSaving((s) => new Set(s).add(errKey))
    setAnnounce(`Saving ${col.label}…`)
    const res = await writeGridCells(tableId, row.id, { view_id: view.id, cells, expected_updated_at: expectedVersion(row) })
    setSaving((s) => { const n = new Set(s); n.delete(errKey); return n })
    const outcome = settleSave(previous, col, res as SaveAnswer)
    setLocalRows((rs) => rs.map((r) => (r.id === row.id ? outcome.row : r)))
    if (outcome.cellError) setCellErrors((e) => ({ ...e, [errKey]: outcome.cellError! }))
    if (outcome.notice) setNotice(outcome.notice)
    setAnnounce(outcome.announce)
    // The row may belong to another group now (or its children link value changed).
    if (!outcome.cellError && (groupBy.includes(col.key) || hasChildren)) refreshRows()
  }

  // Columns drawn in the grid.
  const legacyColumns = columns.filter(c => c.name !== 'ID' && c.name !== 'Date Created')
  const leadCols = hasChildren ? 3 : 2
  const colCount = gridCols.length + leadCols + 2

  const lineCount = localRows.length + (session?.added.length ?? 0)
  function focusCell(r: number, c: number) {
    const rr = Math.max(0, Math.min(lineCount - 1, r))
    const cc = Math.max(0, Math.min(gridCols.length - 1, c))
    setFocus({ r: rr, c: cc })
    const el = scrollRef.current
    if (el && windowed) {
      const y = rr * ROW_HEIGHT
      if (y < el.scrollTop) el.scrollTop = y
      else if (y + ROW_HEIGHT * 2 > el.scrollTop + el.clientHeight) el.scrollTop = y - el.clientHeight + ROW_HEIGHT * 2
    }
    requestAnimationFrame(() => requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-cell="${rr}:${cc}"]`)?.focus()))
  }

  const editableCol = (col: GridColumnDef) => inline && isColumnEditable(col) && !['id', 'date_created'].includes(col.key)

  function onCellKey(e: React.KeyboardEvent, r: number, c: number, row: DataRow) {
    if (editing) return
    const col = gridCols[c]
    if (e.key === 'ArrowRight') { e.preventDefault(); focusCell(r, c + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusCell(r, c - 1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(r + 1, c) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c) }
    else if (e.key === 'Home') { e.preventDefault(); focusCell(e.ctrlKey ? 0 : r, 0) }
    else if (e.key === 'End') { e.preventDefault(); focusCell(e.ctrlKey ? localRows.length - 1 : r, gridCols.length - 1) }
    else if (e.key === 'PageDown') { e.preventDefault(); focusCell(r + 10, c) }
    else if (e.key === 'PageUp') { e.preventDefault(); focusCell(r - 10, c) }
    else if (e.key === ' ' && col?.control === 'boolean' && editableCol(col)) { e.preventDefault(); void saveCell(row, col, !(getCellValue(row.data, { key: col.key, name: col.label }) === true)) }
    else if ((e.key === 'Enter' || e.key === 'F2') && col && editableCol(col)) { e.preventDefault(); setEditing({ row: row.id, col: col.key }) }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && col && editableCol(col) && col.control !== 'boolean') { e.preventDefault(); void saveCell(row, col, null) }
    else if (e.key === 'Enter' && !inline) { e.preventDefault(); setDetailRowId(row.id) }
  }

  /** One cell of an "Edit all rows" session: a field box (or a checkbox) that edits in place; read-only cells flat with a lock. */
  function editAllCell(key: string, values: Record<string, unknown>, col: GridColumnDef, r: number, c: number, rowLabel: string) {
    const s = session!
    const value = cellValue(s, key, col.key)
    const canEdit = editAllCanEdit(key, col.key)
    const changed = isCellChanged(s, key, col.key)
    const err = s.errors[key]?.[col.key]
    const isEditing = ea.editing?.row === key && ea.editing.col === col.key
    const selected = ea.multi && inRange(ea.range, r, c)
    const focused = ea.pos.r === r && ea.pos.c === c
    const label = `${col.label}, row ${rowLabel}`
    return (
      <td key={col.key} role="gridcell" data-cell={`${r}:${c}`} data-col={col.key} aria-colindex={c + leadCols + 1}
        tabIndex={focused ? 0 : -1} aria-readonly={!canEdit || undefined} aria-invalid={err ? true : undefined} aria-selected={ea.multi ? selected : undefined}
        onFocus={() => { if (!focused) ea.setPos({ r, c }) }}
        onKeyDown={(e) => ea.onCellKey(e, r, c)}
        onMouseDown={(e) => { if (e.shiftKey && !isEditing) { e.preventDefault(); ea.setAnchor((a) => a ?? ea.pos); ea.setPos({ r, c }) } }}
        onClick={(e) => {
          if (e.shiftKey || isEditing) return
          ea.setAnchor(null); ea.setPos({ r, c })
          if (canEdit && col.control !== 'boolean') ea.setEditing({ row: key, col: col.key })
        }}
        className={cn(tdClass, 'px-1.5 py-1', numericControl(col) && 'num text-right', isEditing && editorFloats(col) && 'relative',
          selected && 'bg-primary-wash', err && 'outline outline-1 -outline-offset-1 outline-(--status-blocked)', focused && !isEditing && 'outline outline-2 -outline-offset-2 outline-primary')}
        style={{ ...(col.width ? { minWidth: col.width } : {}), ...(changed && !selected ? { backgroundColor: EDIT_ALL_CHANGED_WASH } : {}) }}
        data-changed={changed || undefined} data-grid-readonly={!canEdit || undefined} title={err ?? (!canEdit ? 'Read-only' : undefined)}>
        {isEditing ? (
          <GridCellEditor col={col} value={value} row={values} label={label} invalid={Boolean(err)} initialText={ea.editing?.initial}
            onCommit={(next, move) => { ea.commit(key, col.key, next); ea.afterEdit(r, c, key, col.key, move) }}
            onCancel={() => ea.afterCancel(r, c, key, col.key)} />
        ) : col.control === 'boolean' ? (
          <span className="flex justify-center">
            <input type="checkbox" tabIndex={-1} className="accent-primary size-4" checked={value === true} disabled={!canEdit} aria-label={label}
              onChange={(e) => ea.apply([{ row: key, col: col.key, value: e.target.checked }])} />
          </span>
        ) : (
          <span className={cn(canEdit ? EDIT_ALL_FIELD : EDIT_ALL_READONLY, numericControl(col) && 'justify-end', changed && 'border-primary font-medium')} style={changed ? { backgroundColor: EDIT_ALL_CHANGED_WASH } : undefined}>
            <GridCellDisplay col={col} value={value} row={values} />
            {!canEdit && <Lock className="ml-auto size-3 shrink-0" aria-hidden />}
          </span>
        )}
        <span className="sr-only">{changed ? ', changed' : ''}{canEdit ? '' : ', read-only'}</span>
        {err && !isEditing && <span className="block text-2xs text-(--status-blocked)" data-grid-cell-error>{err}</span>}
      </td>
    )
  }

  // Windowing: only the rows in view (plus overscan) are drawn on long pages.
  // Not while grouped or with child panels open (rows are no longer one height).
  const windowed = !grouped && localRows.length > WINDOW_FROM && !localRows.some((row) => childRels.some((rel) => openChildren.has(`${row.id}:${rel.id}`)))
  const first = windowed ? Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN) : 0
  const last = windowed ? Math.min(localRows.length, Math.ceil((scroll.top + scroll.height) / ROW_HEIGHT) + OVERSCAN) : localRows.length
  // Keep the focused / edited row drawn (focus must not land on a removed element).
  const drawn = localRows.slice(first, last)

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(1)
  }

  /** One data row (with its open child-record panels under it); `r` is its index among the loaded rows (focus / edit-all coordinates). */
  function renderRow(row: DataRow, r: number) {
                const editor = row.updater ?? row.creator
                const editorName = editor?.display_name ?? editor?.email ?? null
                const selected = selectedRows.has(row.id)
                const edited = row.updated_at ?? row.created_at
                const stickyBg = selected
                  ? 'bg-panel bg-[image:linear-gradient(var(--theme-primary-light),var(--theme-primary-light))]'
                  : 'bg-panel group-hover/row:bg-subtle'
                const rowLabel = String(row.data?.id ?? row.id.slice(0, 8))
                const openRels = childRels.filter((rel) => openChildren.has(`${row.id}:${rel.id}`))
                return (
                  <Fragment key={row.id}>
                  <tr
                    data-row-id={row.id}
                    data-selected={selected || undefined}
                    aria-rowindex={inline ? (page - 1) * pageSize + r + 2 : undefined}
                    tabIndex={inline ? undefined : 0}
                    onClick={inline ? undefined : () => setDetailRowId(row.id)}
                    onKeyDown={inline ? undefined : (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setDetailRowId(row.id) }}
                    className={cn(trClass, 'group/row [&>td]:border-b [&>td]:border-border-subtle last:[&>td]:border-b-0', !inline && 'cursor-pointer')}
                    style={windowed ? { height: ROW_HEIGHT } : undefined}
                  >
                    <td className={cn(tdClass, STICKY_SELECT, stickyBg)} onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected} onChange={() => toggleRow(row.id)} aria-label={`Select row ${rowLabel}`} />
                    </td>
                    <td className={cn(tdClass, STICKY_ID, stickyBg, stickyEdge)}>
                      <Tooltip content={copiedId === row.id ? 'Copied' : 'Copy row ID'}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); copyId(row.id) }} className="font-mono text-xs text-fg-muted hover:text-fg" aria-label={`Copy row ID ${row.id}`}>
                          {row.id.slice(0, 8)}
                        </button>
                      </Tooltip>
                    </td>
                    {hasChildren && (
                      <td className={cn(tdClass, 'w-px whitespace-nowrap px-1')} onClick={(e) => e.stopPropagation()} data-child-cell>
                        {childRels.map((rel) => (
                          <ChildToggle key={rel.id} relation={rel} count={childInfo?.counts[rel.id]?.[row.id]} open={openChildren.has(`${row.id}:${rel.id}`)}
                            onToggle={() => childExpand.toggle(`${row.id}:${rel.id}`)} rowLabel={rowLabel} />
                        ))}
                      </td>
                    )}
                    {gridCols.map((col, c) => {
                      if (session) return editAllCell(row.id, { ...(row.data ?? {}), ...(session.drafts[row.id] ?? {}) }, col, r, c, rowLabel)
                      const value = getCellValue(row.data, { key: col.key, name: col.label })
                      const key = `${row.id}:${col.key}`
                      const isEditing = editing?.row === row.id && editing.col === col.key
                      const canEdit = editableCol(col)
                      const err = cellErrors[key]
                      const busy = saving.has(key)
                      return (
                        <td
                          key={col.key}
                          role={inline ? 'gridcell' : undefined}
                          data-cell={inline ? `${r}:${c}` : undefined}
                          data-col={col.key}
                          tabIndex={inline ? (focus.r === r && focus.c === c ? 0 : -1) : undefined}
                          aria-readonly={inline && !canEdit ? true : undefined}
                          aria-invalid={err ? true : undefined}
                          aria-busy={busy || undefined}
                          title={err}
                          onFocus={inline ? () => setFocus({ r, c }) : undefined}
                          onKeyDown={inline ? (e) => onCellKey(e, r, c, row) : undefined}
                          onDoubleClick={inline && canEdit ? () => setEditing({ row: row.id, col: col.key }) : undefined}
                          className={cn(
                            tdClass,
                            numericControl(col) && 'num whitespace-nowrap text-right',
                            (col.control === 'date' || col.control === 'datetime') && 'num whitespace-nowrap',
                            col.control === 'boolean' && 'text-center',
                            inline && canEdit && 'cursor-text',
                            inline && !canEdit && 'text-fg-muted',
                            isEditing && editorFloats(col) && 'relative',
                            err && 'outline outline-1 -outline-offset-1 outline-(--status-blocked)',
                          )}
                          style={col.width ? { minWidth: col.width } : undefined}
                          data-grid-readonly={inline && !canEdit ? true : undefined}
                        >
                          {isEditing ? (
                            <GridCellEditor col={col} value={value} row={row.data ?? {}} label={`${col.label}, row ${rowLabel}`} invalid={Boolean(err)}
                              onCommit={(next, move) => {
                                setEditing(null)
                                void saveCell(row, col, next)
                                if (move === 'down') focusCell(r + 1, c)
                                else if (move === 'next') { const n = gridCols.findIndex((x, xi) => xi > c && editableCol(x)); focusCell(r, n >= 0 ? n : c) }
                                else if (move === 'prev') { const p = gridCols.map((x, xi) => (xi < c && editableCol(x) ? xi : -1)).filter((xi) => xi >= 0).pop(); focusCell(r, p ?? c) }
                                else focusCell(r, c)
                              }}
                              onCancel={() => { setEditing(null); focusCell(r, c) }} />
                          ) : (
                            <span className="inline-flex max-w-full items-center gap-1">
                              <GridCellDisplay col={col} value={value} row={row.data ?? {}} />
                              {busy && <Loader2 className="size-3 shrink-0 animate-spin text-fg-muted" aria-hidden />}
                              {inline && canEdit && <span className="sr-only">, editable — press Enter</span>}
                              {inline && !canEdit && <span className="sr-only">, read-only</span>}
                            </span>
                          )}
                          {err && !isEditing && <span className="block text-2xs text-(--status-blocked)" data-grid-cell-error>{err}</span>}
                        </td>
                      )
                    })}
                    <td className={cn(tdClass, 'max-w-60')}>
                      {session?.conflicts[row.id] ? (
                        <div className="flex min-w-0 flex-col gap-1 text-xs" data-edit-all-conflict={row.id} role="group" aria-label={`Conflict on row ${rowLabel}`}>
                          <span className="text-warning">{session.conflicts[row.id].message.split('.')[0]}.</span>
                          <span className="flex gap-1">
                            <Button size="sm" variant="secondary" onClick={() => { ea.set(resolveConflict(session, row.id, 'mine')); setAnnounce('Your changes are kept; save to write them over the newer row') }} data-edit-all-keep-mine>Keep mine</Button>
                            <Button size="sm" variant="ghost" onClick={() => {
                              const theirs = session.conflicts[row.id]
                              ea.set(resolveConflict(session, row.id, 'theirs'))
                              setLocalRows((rows) => rows.map((x) => (x.id === row.id ? { ...x, data: theirs.theirs as DataRow['data'], updated_at: theirs.version ?? x.updated_at } : x)))
                              setAnnounce('Took their values')
                            }} data-edit-all-take-theirs>Take theirs</Button>
                          </span>
                        </div>
                      ) : session?.locked[row.id] ? (
                        <span className="inline-flex items-center gap-1 text-xs text-fg-muted" data-edit-all-locked={row.id}><Lock className="size-3" aria-hidden /> {session.locked[row.id]}</span>
                      ) : (
                      <div className="flex min-w-0 items-center gap-2" title={formatAbsolute(edited)}>
                        {editorName && <Avatar name={editorName} size="sm" />}
                        <span className="truncate text-xs">
                          <span className="text-fg">{editorName ?? '—'}</span>
                          <span className="num text-fg-muted"> · {formatRelative(edited)}</span>
                        </span>
                      </div>
                      )}
                    </td>
                    <td className={cn(tdClass, 'w-px whitespace-nowrap text-right')} onClick={(e) => e.stopPropagation()}>
                      <div className={cn('inline-flex items-center gap-0.5 transition-opacity duration-[var(--ds-dur-fast)] [@media(pointer:coarse)]:opacity-100', inline ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100')}>
                        <IconButton size="sm" label="Open row" icon={<PanelRightOpen />} onClick={() => setDetailRowId(row.id)} />
                        {canDelete && <IconButton size="sm" variant="danger-ghost" label="Delete row" icon={<Trash2 />} onClick={() => setPendingDelete(row.id)} />}
                      </div>
                    </td>
                  </tr>
                  {openRels.map((rel) => (
                    <tr key={rel.id} data-child-panel={`${row.id}:${rel.id}`}>
                      <td colSpan={colCount} className="border-b border-border-subtle bg-subtle/40 px-3">
                        <div className="sticky left-3 max-w-[calc(100vw-6rem)]">
                          <ChildRecords parentTableId={tableId} parentRowId={row.id} relation={rel} depth={0} ancestors={[row.id]} expand={childExpand} canManage={can('data.manage_rows')} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  </Fragment>
                )
  }

  /** A line of the grouped grid: a group header (toggle, value, count, sums), a row, or a group's "show more" / loading line. */
  function renderGroupItem(item: GroupItem) {
    if (item.kind === 'row') return renderRow(item.row, rowIndex.get(item.row.id) ?? 0)
    const indent = { paddingLeft: `calc(0.75rem + ${item.level * 1.5}rem)` }
    if (item.kind === 'loading') {
      return (
        <tr key={`${item.id}:loading`} aria-hidden><td colSpan={colCount} className={cn(tdClass, 'text-xs text-fg-muted')} style={indent}>
          <span className="sticky left-3 inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Loading rows…</span>
        </td></tr>
      )
    }
    if (item.kind === 'more') {
      const limit = Math.min(GRID_LIMITS.pageSize, groupLimits[item.id] ?? pageSize)
      const capped = limit >= GRID_LIMITS.pageSize
      return (
        <tr key={`${item.id}:more`} data-group-more={item.id}><td colSpan={colCount} className={cn(tdClass, 'border-b border-border-subtle text-xs text-fg-muted')} style={indent}>
          <span className="sticky left-3 inline-flex items-center gap-2">
            <span className="num">Showing {item.shown} of {item.total}</span>
            {capped
              ? <span>— search to narrow this group</span>
              : <Button size="sm" variant="ghost" onClick={() => setGroupLimits((m) => ({ ...m, [item.id]: Math.min(GRID_LIMITS.pageSize, limit + pageSize) }))}>Show more</Button>}
          </span>
        </td></tr>
      )
    }
    const key = groupBy[item.level]
    const schema = tableColumns.find((c) => c.key === key)
    const label = groupLabel(item.node.value, schema?.type)
    const sums = Object.entries(item.node.sums ?? {}).filter(([k]) => sumCols.includes(k))
    const Chevron = item.open ? ChevronDown : ChevronRight
    return (
      <tr key={item.id} data-group-row={item.id} data-group-level={item.level} className={item.level === 0 ? 'bg-subtle' : 'bg-subtle/50'}>
        <td colSpan={colCount} className={cn(tdClass, 'border-b border-border py-1.5')} style={indent}>
          <button type="button" onClick={() => toggleGroup(item.id)} aria-expanded={item.open} className="sticky left-3 inline-flex max-w-full items-center gap-2 text-left text-ui hover:text-fg"
            aria-label={`${schema?.name ?? key}: ${label}, ${plural(item.node.count, 'row')}. ${item.open ? 'Collapse' : 'Expand'}`}>
            <Chevron className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="text-xs text-fg-muted">{schema?.name ?? key}:</span>
            <span className={cn('truncate font-medium', item.node.value === null ? 'italic text-fg-muted' : 'text-fg')}>{label}</span>
            <span className="num rounded-full bg-panel px-1.5 py-0.5 text-2xs text-fg-muted">{item.node.count}</span>
            {sums.map(([k, v]) => (
              <span key={k} className="num text-xs text-fg-muted">{colByKeyAll.get(k)?.label ?? k}: <span className="text-fg">{formatSum(k, v)}</span></span>
            ))}
          </button>
        </td>
      </tr>
    )
  }
  const rowIndex = new Map(localRows.map((row, i) => [row.id, i]))

  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel">
        <EmptyState
          size="sm"
          icon={Columns3}
          title="This table has no columns yet"
          description="Add columns on the Schema tab, then come back to add rows."
        />
      </div>
    )
  }

  const stickyEdge = scroll.left && 'shadow-[6px_0_6px_-6px_var(--ds-border-strong)]'

  function sortHeader({ id, label, numeric, icon: Icon, className, locked }: { id: string; label: string; numeric?: boolean; icon?: typeof Type; className?: string; locked?: boolean }) {
    const active = sortCol === id
    return (
      <th
        key={id}
        scope="col"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
        className={cn(thClass, 'h-auto min-h-8 whitespace-normal py-1.5', numeric && 'text-right', className)}
      >
        <button
          type="button"
          onClick={() => toggleSort(id)}
          className={cn('inline-flex max-w-full items-center gap-1.5 text-left hover:text-fg', numeric && 'flex-row-reverse text-right', active && 'text-fg')}
        >
          {Icon && <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />}
          <span className="line-clamp-2 break-words">{label}</span>
          {locked && <Lock className="size-3 shrink-0 text-fg-muted" aria-label="read-only" />}
          {active && (sortDir === 'asc' ? <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" /> : <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />)}
        </button>
      </th>
    )
  }

  const iconFor = (col: GridColumnDef) => {
    const schema = columns.find((c) => columnKey(c) === col.key)
    return schema ? COLUMN_TYPE_ICON[schema.type] ?? Type : Type
  }

  return (
    <GridSurfaceProvider value={surface}>
    <GridLabelsProvider value={labels}>
    <div className="space-y-3" data-data-grid data-view={view.id} data-inline={inline || undefined}>
      {/* Toolbar: view, search, match count / selection, settings, add row */}
      <div className="flex flex-wrap items-center gap-2">
        {(views.length > 0 || can('data.edit_schema')) && (
          <select aria-label="View" className="h-8 rounded-md border border-border bg-panel px-2 text-ui disabled:opacity-50" value={view.id} onChange={(e) => chooseView(e.target.value)} data-testid="grid-view-select"
            disabled={dirty} title={dirty ? 'Save or cancel your changes to switch views' : undefined}>
            {views.length === 0 && <option value="default">All columns</option>}
            {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        <SearchInput
          value={searchText}
          onValueChange={setSearchText}
          placeholder="Search rows by any value or ID…"
          aria-label="Search rows"
          wrapperClassName="w-full max-w-sm"
        />
        {search && (
          <span className="num text-xs text-fg-muted">
            {plural(total, 'match', 'matches')}{pageData?.truncated ? ' in the newest rows' : ''}
          </span>
        )}
        {groupableCols.length > 0 && (
          <div className="flex items-center gap-1" data-testid="grid-group-by">
            <select aria-label="Group by" className="h-8 max-w-44 rounded-md border border-border bg-panel px-2 text-ui disabled:opacity-50" value={groupBy[0] ?? ''} onChange={(e) => chooseGroupBy(0, e.target.value)}
              disabled={dirty} title={dirty ? 'Save or cancel your changes to change the grouping' : undefined} data-testid="grid-group-by-1">
              <option value="">No grouping</option>
              {groupableCols.map((c) => <option key={c.key} value={c.key}>Group by {c.name}</option>)}
            </select>
            {grouped && (
              <select aria-label="Then group by" className="h-8 max-w-40 rounded-md border border-border bg-panel px-2 text-ui disabled:opacity-50" value={groupBy[1] ?? ''} onChange={(e) => chooseGroupBy(1, e.target.value)}
                disabled={dirty} data-testid="grid-group-by-2">
                <option value="">Then by…</option>
                {groupableCols.filter((c) => c.key !== groupBy[0]).map((c) => <option key={c.key} value={c.key}>Then by {c.name}</option>)}
              </select>
            )}
            {grouped && <IconButton size="sm" label="Expand all groups" icon={<ChevronsUpDown />} onClick={expandAllGroups} data-testid="grid-groups-expand" />}
            {grouped && <IconButton size="sm" label="Collapse all groups" icon={<ChevronsDownUp />} onClick={collapseAllGroups} data-testid="grid-groups-collapse" />}
            {groupingChanged && saved && can('data.edit_schema') && (
              <Button size="sm" variant="ghost" onClick={() => { void saveGroupingToView() }} data-testid="grid-group-save">Save to view</Button>
            )}
          </div>
        )}
        {inline && !session && <span className="inline-flex items-center gap-1 rounded-full bg-primary-wash px-2 py-0.5 text-2xs font-medium text-primary-text" data-testid="grid-inline-badge">Inline editing</span>}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-1 rounded-md bg-primary-wash py-0.5 pl-3 pr-1">
            <span className="num text-ui font-medium text-primary-text">{selectedRows.size} selected</span>
            <ExtensionToolbarActions objectType="data_row" items={localRows.filter((r) => selectedRows.has(r.id)).map((r) => ({ ...(r.data as Record<string, unknown>), id: r.id }))} />
            {canDelete && (
              <Button size="sm" variant="danger-ghost" leadingIcon={<Trash2 />} onClick={() => setConfirmBulk(true)} disabled={deleting}>
                Delete
              </Button>
            )}
            <IconButton size="sm" label="Clear selection" icon={<X />} onClick={() => setSelectedRows(new Set())} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {can('data.edit_schema') && (
            <Button variant="secondary" size="sm" leadingIcon={<Settings2 />} onClick={() => setSettingsOpen(true)} data-testid="grid-view-settings-open">
              View settings
            </Button>
          )}
          {inline && !session && (
            <Tooltip content="Every row on this page becomes editable at once; save them together" kbd="⇧E">
              <Button variant="secondary" size="sm" leadingIcon={<PencilLine />} onClick={startEditAll} data-testid="grid-edit-all" aria-keyshortcuts="Shift+E">
                Edit all
              </Button>
            </Tooltip>
          )}
          {canAdd && !session && (
            <Tooltip content="Add a row in a panel" kbd="⇧N inline">
              <Button variant="secondary" size="sm" leadingIcon={<Plus />} onClick={() => setSheetAdd(true)}>
                Add row
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
      {grouped && groupNotice && <InlineNotice tone="info" message={groupNotice} onDismiss={() => setGroupNotice(null)} />}
      {grouped && groupData && !groupData.exact && groupData.truncated && (
        <InlineNotice tone="warning" message="Groups are counted from the newest 2,000 rows until the database update for grouping is applied (migration 20270119090000)." />
      )}
      <p className="sr-only" role="status" aria-live="polite" data-testid="grid-announce">{announce}</p>
      {session && (
        <EditAllBar changedRows={changedRowCount(session)} errors={errorCount(session)} conflicts={Object.keys(session.conflicts).length} canUndo={canUndo(session)}
          saving={batchSaving} onUndo={ea.undo} onCancel={cancelEditAll} onSave={() => { void saveAll() }}
          hint="Type to edit · Tab / Enter move on · Esc reverts · paste a block from a spreadsheet · Ctrl/⌘ D fills down" />
      )}

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={updateScroll}
          role="region"
          aria-label="Table rows"
          tabIndex={inline ? -1 : 0}
          data-table-scroll
          className="scrollbar-thin max-h-[calc(100vh-280px)] min-h-48 overflow-auto overscroll-x-contain rounded-lg border border-border bg-panel [-webkit-overflow-scrolling:touch]"
        >
          <table ref={gridRef} role={inline ? 'grid' : undefined} aria-label={session ? 'Rows (editing all rows)' : inline ? 'Rows (editable)' : undefined} aria-rowcount={inline ? total + 1 + (session?.added.length ?? 0) : undefined}
            aria-colcount={session ? colCount : undefined} aria-multiselectable={session ? true : undefined} data-edit-all={session ? true : undefined}
            onPaste={session ? ea.onPaste : undefined} onCopy={session ? ea.onCopy : undefined}
            aria-busy={isFetching || undefined} className="w-full border-separate border-spacing-0 text-left text-ui text-fg">
            <thead className="sticky top-0 z-[3]">
              <tr>
                <th scope="col" className={cn(thClass, STICKY_SELECT, 'z-[4]')}>
                  <Checkbox
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                    aria-label="Select all rows on this page"
                  />
                </th>
                {sortHeader({ id: '_row_id', label: 'Row', className: cn(STICKY_ID, 'z-[4]', stickyEdge) })}
                {hasChildren && <th scope="col" className={cn(thClass, 'w-px whitespace-nowrap')} title={childRels.map((r) => r.label || r.table_name).join(', ')}>{childRels.length === 1 ? (childRels[0].label || childRels[0].table_name || 'Children') : 'Children'}</th>}
                {gridCols.map((col) => sortHeader({
                  id: col.key,
                  label: col.label || 'Untitled',
                  numeric: numericControl(col),
                  icon: iconFor(col),
                  locked: inline && !editableCol(col),
                  className: cn('min-w-28 max-w-60', col.control === 'boolean' && 'text-center'),
                }))}
                {sortHeader({ id: '_updated_at', label: 'Last edited', className: 'min-w-44' })}
                <th scope="col" className={cn(thClass, 'w-px')}><span className="sr-only">Actions</span></th>
              </tr>
              {inlineAdd && canAdd && !session && (
                <tr className="bg-subtle">
                  <td className={cn(tdClass, STICKY_SELECT, 'border-b border-border bg-subtle')} />
                  <td className={cn(tdClass, STICKY_ID, 'border-b border-border bg-subtle text-xs text-fg-muted', stickyEdge)}>New</td>
                  {hasChildren && <td className={cn(tdClass, 'border-b border-border bg-subtle')} />}
                  {gridCols.map((gc) => {
                    const col = legacyColumns.find((c) => columnKey(c) === gc.key)
                    return (
                      <td key={gc.key} className={cn(tdClass, 'min-w-28 border-b border-border px-1.5')}>
                        {col && (
                          <InlineCellEditor
                            column={col}
                            value={newRow[columnKey(col)]}
                            onChange={(value) => setNewRow({ ...newRow, [columnKey(col)]: value })}
                            uploading={uploading === columnKey(col)}
                            onUpload={(file) => uploadNewRowFile(file, columnKey(col))}
                          />
                        )}
                      </td>
                    )
                  })}
                  <td className={cn(tdClass, 'border-b border-border text-xs text-fg-muted')}>
                    <span className="inline-flex items-center gap-1"><Kbd>⇧N</Kbd> to hide</span>
                  </td>
                  <td className={cn(tdClass, 'border-b border-border text-right')}>
                    <Button size="sm" onClick={handleAddRow} loading={addRowGuard.pending}>Add</Button>
                  </td>
                </tr>
              )}
            </thead>
            <tbody>
              {(grouped ? tree.length === 0 && !groupsFetching && groupData?.key === groupKey : localRows.length === 0 && !isFetching) && (
                search ? (
                  <TableEmpty colSpan={colCount} variant="no-results" title={`No rows match “${search}”`} action={{ label: 'Clear search', onClick: () => setSearchText('') }} />
                ) : (
                  <TableEmpty colSpan={colCount} icon={Plus} title="No rows yet" description="Add the first row, or import rows from a file."
                    action={canAdd ? { label: 'Add row', onClick: () => setSheetAdd(true) } : undefined} />
                )
              )}
              {windowed && first > 0 && <tr aria-hidden style={{ height: first * ROW_HEIGHT }}><td colSpan={colCount} /></tr>}
              {grouped
                ? groupItems.map((item) => renderGroupItem(item))
                : drawn.map((row, i) => renderRow(row, first + i))}
              {windowed && last < localRows.length && <tr aria-hidden style={{ height: (localRows.length - last) * ROW_HEIGHT }}><td colSpan={colCount} /></tr>}
              {session?.added.map((added, i) => {
                const r = localRows.length + i
                const label = `new ${i + 1}`
                return (
                  <tr key={added.id} aria-rowindex={total + 2 + i} data-edit-all-new={added.id} className={cn(trClass, '[&>td]:border-b [&>td]:border-border-subtle')}>
                    <td className={cn(tdClass, STICKY_SELECT, 'bg-panel')} />
                    <td className={cn(tdClass, STICKY_ID, 'bg-panel text-xs font-medium text-primary-text', stickyEdge)}>New</td>
                    {hasChildren && <td className={tdClass} />}
                    {gridCols.map((col, c) => editAllCell(added.id, added.values, col, r, c, label))}
                    <td className={cn(tdClass, 'text-xs text-fg-muted')}>Not saved yet</td>
                    <td className={cn(tdClass, 'w-px whitespace-nowrap text-right')}>
                      <IconButton size="sm" label={`Remove new row ${i + 1}`} icon={<X />} onClick={() => ea.set(removeAddedRow(session, added.id))} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {scroll.right && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-px right-px w-6 rounded-r-lg bg-gradient-to-l from-[var(--ds-border-strong)] to-transparent opacity-40" />
        )}
      </div>

      {session && canAdd && (
        <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={ea.addRow} data-edit-all-add>Add row</Button>
      )}

      {/* Server-side paging */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span className="num">
          {grouped
            ? (groupData ? `${plural(groupData.total, 'row')} in ${plural(tree.length, 'group')}${groupData.groups_truncated ? ' (more groups not shown)' : ''}` : '')
            : total ? `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}` : ''}
          {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin" aria-hidden />}
        </span>
        {!grouped && pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-1">
            <IconButton size="sm" label="Previous page" icon={<ChevronLeft />} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
            <span className="num">Page {page} of {pages}</span>
            <IconButton size="sm" label="Next page" icon={<ChevronRight />} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} />
          </nav>
        )}
      </div>

      <RowDetailDrawer
        open={detailRowId !== null}
        onOpenChange={(open) => { if (!open) setDetailRowId(null) }}
        row={detailRow as any}
        columns={legacyColumns}
        tableId={tableId}
      />
      <AddRowSheet open={sheetAdd} onOpenChange={setSheetAdd} columns={legacyColumns} tableId={tableId} tenantId={tenantId} />
      {can('data.edit_schema') && (
        <GridViewSettings open={settingsOpen} onOpenChange={setSettingsOpen} tableId={tableId} tableColumns={tableColumns} views={views} viewId={view.id}
          onSaved={(next, id) => { queryClient.setQueryData(['data-grid-views', tableId], next); chooseView(id) }} />
      )}
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        destructive
        title={`Discard ${plural(session ? changedRowCount(session) : 0, 'changed row')}?`}
        description="Your edits in this session are not saved."
        confirmLabel="Discard changes"
        onConfirm={() => { setConfirmDiscard(false); ea.stop(); setAnnounce('Changes discarded') }}
      />
      <ConfirmDialog
        open={leaveGuard.pending !== null}
        onOpenChange={(open) => { if (!open) leaveGuard.stay() }}
        destructive
        title="Leave without saving?"
        description={`${plural(session ? changedRowCount(session) : 0, 'changed row')} will be lost.`}
        confirmLabel="Leave"
        onConfirm={leaveGuard.leave}
      />
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        destructive
        title={`Delete ${plural(selectedRows.size, 'row')}?`}
        description="The selected rows are deleted permanently."
        confirmLabel="Delete rows"
        busy={deleting}
        onConfirm={deleteSelected}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        destructive
        title="Delete this row?"
        description="The row is deleted permanently."
        confirmLabel="Delete row"
        onConfirm={() => { if (pendingDelete) void handleDelete(pendingDelete) }}
      />
    </div>
    </GridLabelsProvider>
    </GridSurfaceProvider>
  )
}

// ─── Inline new-row editor (Shift+N) ───
function InlineCellEditor({ column, value, onChange, uploading, onUpload }: {
  column: DataColumn
  value: any
  onChange: (value: any) => void
  uploading: boolean
  onUpload: (file: File) => void
}) {
  const label = column.name || 'Untitled'
  if (column.type === 'boolean') {
    return <div className="text-center"><Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} aria-label={label} /></div>
  }
  if (column.type === 'file') {
    return <FileCell value={value} uploading={uploading} onUpload={onUpload} onClear={() => onChange(null)} />
  }
  if (column.type === 'select') {
    return (
      <Select size="sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label}
        placeholder="Select…" options={(column.options ?? []).map(o => ({ value: o, label: o }))} />
    )
  }
  if (column.type === 'lookup') return <LookupCellEditor column={column} value={value} onChange={onChange} />
  return (
    <Input
      size="sm"
      type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={cn(column.type === 'number' && 'num text-right')}
    />
  )
}

// ─── File upload cell (inline new row) ───
function FileCell({ value, uploading, onUpload, onClear }: {
  value: any
  uploading: boolean
  onUpload: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const fileData = value && typeof value === 'object' ? value : null

  if (uploading) {
    return (
      <div className="flex items-center gap-1 text-xs text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" /> Uploading…
      </div>
    )
  }

  if (fileData?.url) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <FileText className="size-3.5 shrink-0 text-fg-muted" />
        <span className="truncate text-xs">{fileData.name ?? 'File'}</span>
        <IconButton size="sm" label="Remove file" icon={<X />} onClick={onClear} />
      </div>
    )
  }

  return (
    <>
      <Button size="sm" variant="ghost" leadingIcon={<Upload />} onClick={() => inputRef.current?.click()}>
        Upload
      </Button>
      <input ref={inputRef} type="file" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) onUpload(file)
        e.target.value = ''
      }} />
    </>
  )
}

function LookupCellEditor({
  column,
  value,
  onChange,
}: {
  column: DataColumn
  value: any
  onChange: (value: string) => void
}) {
  const { data: options = [], isLoading } = useLookupOptions(column.lookup, true)

  return (
    <Select size="sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={isLoading} aria-label={column.name || 'Lookup'}>
      <option value="">{isLoading ? 'Loading…' : 'Select…'}</option>
      {options.map((option) => (
        <option key={`${column.id}:${option.value}`} value={option.value}>{option.label}</option>
      ))}
    </Select>
  )
}
