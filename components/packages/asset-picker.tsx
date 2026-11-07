'use client'

/**
 * Asset picker for the package editor, built for workspaces with thousands
 * of assets: server-side search (debounced, cursor-paged 50 at a time, more
 * loaded as you scroll) across every type a package can carry, type chips
 * with match counts, tag / updated / owner filters, a windowed list (only the
 * visible rows are rendered), multi-select, and "include dependencies".
 *
 * Combobox pattern: focus stays in the search box; ↑↓ PageUp PageDown Home
 * End move the highlight (aria-activedescendant), Enter selects / unselects,
 * Ctrl/⌘+Enter adds the selection, Esc closes the list (then clears the
 * search). Rules live in lib/packages/asset-picker (unit-tested).
 */

import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  Archive, BarChart3, Bot, Cable, Check, FileText, Grid3x3, Mail, Palette, Plug, Puzzle, ScrollText, Search, Server, Shield, Table2, Workflow, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate as formatDay } from '@/lib/format/date'
import { formatCount } from '@/lib/format/number'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import { InlineNotice } from '@/components/ui/inline-notice'
import { searchPackageAssetsAction } from '@/app/actions/packages'
import {
  isSelectable, pickerKey, refKey, scrollToRow, shouldLoadMore, toggle, visibleWindow,
  type AssetRefLike, type Membership, type PickerState,
} from '@/lib/packages/asset-picker'
import type { AssetHit, AssetSearchInput } from '@/lib/services/package-assets'

export const TYPE_ICON: Record<string, LucideIcon> = {
  workflow: Workflow, workflow_activity: Puzzle, data_table: Table2, integration: Plug, connector: Cable, decision_table: Grid3x3,
  email_template: Mail, agent: Bot, report: BarChart3, role: Shield, mcp_server: Server, retention_policy: Archive, log_destination: ScrollText,
  form: FileText, form_theme: Palette, form_control: Puzzle,
}

const ROW_HEIGHT = 56
const VIEWPORT = 336
const PAGE_SIZE = 50
const SINCE_OPTIONS = [{ value: '', label: 'Any time' }, { value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' }]
const MEMBERSHIP_LABEL: Record<string, string> = { root: 'In package', manual: 'In package', dependency: 'Dependency', excluded: 'Left out' }

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

async function search(input: AssetSearchInput) {
  const result = await searchPackageAssetsAction(input)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function formatDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : formatDay(date)
}

export interface AssetPickerProps {
  /** How each asset (by `type:id`) is already part of the package. */
  membership: ReadonlyMap<string, Membership>
  /** No roots yet: the first add starts the package. */
  emptyPackage: boolean
  onAdd: (refs: AssetRefLike[], withDependencies: boolean) => Promise<void> | void
  /** Set to a function telling the dialog whether Escape belongs to the picker. */
  escapeRef?: MutableRefObject<(() => boolean) | null>
}

export function AssetPicker({ membership, emptyPackage, onAdd, escapeRef }: AssetPickerProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [tag, setTag] = useState('')
  const [since, setSince] = useState('')
  const [owner, setOwner] = useState('')
  const [sort, setSort] = useState<'name' | 'updated'>('name')
  const [state, setState] = useState<PickerState>({ open: emptyPackage, active: -1, selected: new Map() })
  const [withDeps, setWithDeps] = useState(true)
  const [adding, setAdding] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [everOpened, setEverOpened] = useState(emptyPackage)
  const searchText = useDebounced(text.trim(), 250)

  const filters = useMemo(() => ({ search: searchText || undefined, tag: tag || undefined, updated_since: since || undefined, owner: owner || undefined, sort }), [searchText, tag, since, owner, sort])
  const query = useInfiniteQuery({
    queryKey: ['package-assets', filters, types],
    queryFn: ({ pageParam }) => search({ ...filters, types: types.length ? types : undefined, limit: PAGE_SIZE, after: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: everOpened,
    staleTime: 30_000,
  })
  // Chip counts ignore the type filter (one cheap request while types are filtered).
  const allCounts = useQuery({
    queryKey: ['package-asset-counts', filters],
    queryFn: () => search({ ...filters, limit: 1 }),
    enabled: everOpened && types.length > 0,
    staleTime: 30_000,
  })

  const rows = useMemo<AssetHit[]>(() => (query.data?.pages ?? []).flatMap((page) => page.assets), [query.data])
  const first = query.data?.pages[0]
  const chipSource = types.length ? allCounts.data ?? null : first ?? null
  const total = first?.total ?? 0
  const facetTags = first?.facets?.tags ?? allCounts.data?.facets?.tags ?? []

  // Reset the highlight and scroll when the result set changes.
  useEffect(() => {
    setState((prev) => ({ ...prev, active: -1 }))
    setScrollTop(0)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [filters, types])

  const win = visibleWindow(scrollTop, VIEWPORT, ROW_HEIGHT, rows.length)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (state.open && shouldLoadMore(Math.max(win.end, state.active + 1), rows.length, Boolean(hasNextPage), isFetchingNextPage)) void fetchNextPage()
  }, [state.open, win.end, state.active, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    if (!escapeRef) return
    escapeRef.current = () => Boolean(rootRef.current?.contains(document.activeElement) && (state.open || text))
    return () => { escapeRef.current = null }
  }, [escapeRef, state.open, text])

  const open = () => {
    setEverOpened(true)
    setState((prev) => (prev.open ? prev : { ...prev, open: true }))
  }

  const commit = async (refs: AssetRefLike[]) => {
    if (!refs.length) return
    setAdding(true)
    try {
      await onAdd(refs, withDeps)
      setState((prev) => ({ ...prev, selected: new Map(), open: false }))
      setText('')
    } finally {
      setAdding(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!everOpened) setEverOpened(true)
    const result = pickerKey(state, event, rows, membership, text)
    if (!result.handled) return
    event.preventDefault()
    if (result.action.kind === 'add') {
      const refs = result.action.refs
      // Keep the selection until the add succeeds (commit clears it).
      void commit(refs)
      return
    }
    if (result.action.kind === 'clear-search') setText('')
    setState(result.state)
    if (result.state.active >= 0 && listRef.current) {
      const next = scrollToRow(result.state.active, listRef.current.scrollTop, VIEWPORT, ROW_HEIGHT)
      if (next !== listRef.current.scrollTop) listRef.current.scrollTop = next
    }
  }

  const toggleType = (type: string) => setTypes((list) => (list.includes(type) ? list.filter((t) => t !== type) : [...list, type]))
  const selectedCount = state.selected.size
  const activeId = state.active >= 0 && state.active < rows.length ? `${listId}-opt-${state.active}` : undefined
  const chipTypes = (first?.types ?? []).filter((t) => types.includes(t.type) || (chipSource?.counts[t.type] ?? 0) > 0)

  return (
    <div ref={rootRef} className="mb-4 rounded-lg border border-border bg-panel transition-colors duration-[var(--ds-dur-fast)] focus-within:border-border-strong" data-testid="asset-picker">
      <div className="flex h-10 items-center gap-2 px-3">
        <Search size={16} className="shrink-0 text-fg-muted" aria-hidden />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={state.open}
          aria-controls={`${listId}-list`}
          aria-activedescendant={state.open ? activeId : undefined}
          aria-autocomplete="list"
          aria-label={emptyPackage ? 'Search for what the package starts from' : 'Search assets to add'}
          className="min-w-0 flex-1 bg-transparent text-ui text-fg placeholder:text-fg-subtle focus-visible:outline-none"
          placeholder={emptyPackage ? 'Start from… search workflows, tables, integrations…' : 'Add items… search every asset'}
          value={text}
          onChange={(event) => { setText(event.target.value); open() }}
          onFocus={open}
          onClick={open}
          onKeyDown={onKeyDown}
          data-testid="asset-picker-search"
        />
        {!state.open && <Button size="sm" variant="secondary" onClick={() => { open(); inputRef.current?.focus() }}>Browse</Button>}
      </div>

      {state.open && (
        <>
          <div className="flex flex-wrap gap-1.5 px-3 pb-2" role="group" aria-label="Filter by type">
            <Chip active={!types.length} onClick={() => setTypes([])} label="All" count={chipSource?.total} />
            {chipTypes.map((t) => <Chip key={t.type} active={types.includes(t.type)} onClick={() => toggleType(t.type)} label={t.label} count={chipSource?.counts[t.type]} icon={TYPE_ICON[t.type]} testId={`asset-type-${t.type}`} />)}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
            <Select size="sm" wrapperClassName="w-auto" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag or category"
              options={[{ value: '', label: 'Any tag' }, ...facetTags.map((t) => ({ value: t, label: t }))]} />
            <Select size="sm" wrapperClassName="w-auto" value={since} onChange={(e) => setSince(e.target.value)} aria-label="Updated" options={SINCE_OPTIONS} />
            <Select size="sm" wrapperClassName="w-auto" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner"
              options={[{ value: '', label: 'Anyone' }, { value: 'me', label: 'Created by me' }]} />
            <Select size="sm" wrapperClassName="w-auto" value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'updated')} aria-label="Sort"
              options={[{ value: 'name', label: 'Name A–Z' }, { value: 'updated', label: 'Recently updated' }]} />
            <span className="num ml-auto text-xs text-fg-muted" aria-live="polite" data-testid="asset-picker-total">
              {query.isFetching && !isFetchingNextPage ? 'Searching…' : first ? `${formatCount(total)} match${total === 1 ? '' : 'es'}` : ''}
            </span>
          </div>

          {query.error && <InlineNotice tone="error" message={(query.error as Error).message} className="mx-3 mb-2" />}

          <div
            ref={listRef}
            id={`${listId}-list`}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Assets"
            className="relative overflow-y-auto border-t border-border-subtle scrollbar-thin"
            style={{ height: rows.length ? Math.min(VIEWPORT, rows.length * ROW_HEIGHT) : 72 }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            data-testid="asset-picker-list"
          >
            {!rows.length && !query.isFetching && first && (
              <p className="px-3 py-6 text-center text-ui text-fg-muted">No assets match{searchText ? ` “${searchText}”` : ''}.</p>
            )}
            <div style={{ height: win.totalHeight, position: 'relative' }}>
              {rows.slice(win.start, win.end).map((row, offset) => {
                const index = win.start + offset
                const key = refKey(row)
                const member = membership.get(key) ?? null
                const selectable = isSelectable(member)
                const selected = state.selected.has(key)
                const Icon = TYPE_ICON[row.type] ?? Puzzle
                return (
                  <div
                    key={key}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!selectable}
                    aria-setsize={total || rows.length}
                    aria-posinset={index + 1}
                    className={cn(
                      'absolute left-0 right-0 flex cursor-pointer select-none items-center gap-2.5 px-3',
                      index === state.active ? 'bg-muted' : selected ? 'bg-primary-wash' : undefined,
                      !selectable && 'opacity-70',
                    )}
                    style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => { if (state.active !== index) setState((prev) => ({ ...prev, active: index })) }}
                    onClick={() => setState((prev) => ({ ...prev, active: index, selected: toggle(prev.selected, row, membership) }))}
                    onDoubleClick={() => { if (selectable) void commit([row]) }}
                    data-testid="asset-option"
                  >
                    <span
                      className={cn('flex size-4 shrink-0 items-center justify-center rounded-sm border text-primary-fg', selected ? 'border-primary bg-primary' : 'border-border-strong bg-input')}
                      aria-hidden
                    >
                      {selected && <Check size={12} />}
                    </span>
                    <Icon size={16} className="shrink-0 text-fg-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui text-fg">{row.name}</span>
                      <span className="block truncate text-xs text-fg-muted">
                        {row.label}
                        {row.matched_reference ? ` · reference “${row.matched_reference}”` : ''}
                        {row.description ? ` · ${row.description}` : ''}
                      </span>
                    </span>
                    {member && <Badge tone={member === 'excluded' ? 'neutral' : 'brand'}>{MEMBERSHIP_LABEL[member]}</Badge>}
                    <span className="num w-24 shrink-0 text-right text-xs text-fg-muted">{formatDate(row.updated_at)}</span>
                  </div>
                )
              })}
            </div>
            {isFetchingNextPage && <p className="px-3 py-1 text-xs text-fg-muted">Loading more…</p>}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle px-3 py-2 text-xs text-fg">
            <span className="num" data-testid="asset-picker-selected">{selectedCount ? `${selectedCount} selected` : rows.length ? `${formatCount(rows.length)} of ${formatCount(total)} loaded` : ''}</span>
            {selectedCount > 0 && <Button size="sm" variant="link" onClick={() => setState((prev) => ({ ...prev, selected: new Map() }))}>Clear</Button>}
            <Tooltip content="Everything the selected assets use is added too (recommended). Unticked, their dependencies are left out and must already exist where the package is installed.">
              <span><Checkbox checked={withDeps} onChange={(e) => setWithDeps(e.target.checked)} data-testid="asset-picker-with-deps" label="Include dependencies" /></span>
            </Tooltip>
            <span className="hidden text-fg-muted sm:inline">↑↓ move · Enter select · Ctrl/⌘+Enter add · Esc close</span>
            <Button size="sm" className="ml-auto" disabled={!selectedCount} loading={adding} onClick={() => void commit([...state.selected.values()])} data-testid="asset-picker-add">
              {emptyPackage ? `Start from selected${selectedCount ? ` (${selectedCount})` : ''}` : `Add selected${selectedCount ? ` (${selectedCount})` : ''}`}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Chip({ active, onClick, label, count, icon: Icon, testId }: { active: boolean; onClick: () => void; label: string; count?: number; icon?: LucideIcon; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors duration-[var(--ds-dur-fast)]',
        active ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg hover:bg-subtle',
      )}
      data-testid={testId}
    >
      {Icon && <Icon size={14} aria-hidden />}
      {label}
      {count !== undefined && <span className="num text-fg-muted">{formatCount(count)}</span>}
    </button>
  )
}
