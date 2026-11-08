'use client'

import { useMemo, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, SlidersHorizontal, X } from 'lucide-react'
import { SearchBar, FilterChips } from '@/components/ui/list-controls'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Button } from '@/components/ui/button'
import { CountBadge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogBody, DialogFooter } from '@/components/ui/dialog'
import { SearchableMultiOptionPicker } from '@/components/ui/searchable-multi-option-picker'
import { formatCount } from '@/lib/format/number'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  advancedFilterCount, chipsForView, clearQueueFilters, DATE_FIELDS, hasQueueFilters, QUEUE_VIEWS, SLA_OPTIONS,
  STATUS_CHIPS, TRIGGER_GROUPS,
  type QueueFacets, type QueueFilters, type QueueSla, type QueueSortField, type QueueTriggerGroup, type QueueView, type QueueViewCounts,
} from '@/lib/automations/queue-filters'

interface QueueFiltersBarProps {
  filters: QueueFilters
  update: (patch: Partial<QueueFilters>) => void
  replace: (next: QueueFilters) => void
  searchText: string
  setSearchText: (value: string) => void
  viewCounts: QueueViewCounts | null
  facets: QueueFacets | null
  advancedOpen: boolean
  setAdvancedOpen: (open: boolean) => void
}

const personLabel = (p: { name: string | null; email: string | null; id: string }) => p.name || p.email || p.id.slice(0, 8)

/**
 * The queue's view switcher, search, status chips, sort, advanced filters
 * (inline disclosure on desktop, a bottom sheet on phones) and the active
 * filter chips with Clear all.
 */
export function QueueFiltersBar({ filters, update, replace, searchText, setSearchText, viewCounts, facets, advancedOpen, setAdvancedOpen }: QueueFiltersBarProps) {
  const mobile = useIsMobile()
  const advancedCount = advancedFilterCount(filters)
  const chips = chipsForView(filters.view)

  const labels = useMemo(() => ({
    workflow: new Map((facets?.workflows ?? []).map((w) => [w.id, w.name])),
    person: new Map([...(facets?.starters ?? []), ...(facets?.assignees ?? [])].map((p) => [p.id, personLabel(p)])),
    version: new Map((facets?.versions ?? []).map((v) => [v.id, `v${v.version_number}`])),
  }), [facets])

  const active: Array<{ key: string; label: string; clear: Partial<QueueFilters> }> = []
  if (filters.search.trim()) active.push({ key: 'q', label: `Search: “${filters.search.trim()}”`, clear: { search: '' } })
  for (const s of filters.statuses) active.push({ key: `s:${s}`, label: STATUS_CHIPS.find((c) => c.value === s)?.label ?? s, clear: { statuses: filters.statuses.filter((x) => x !== s) } })
  for (const id of filters.workflowIds) active.push({ key: `wf:${id}`, label: `Workflow: ${labels.workflow.get(id) ?? id.slice(0, 8)}`, clear: { workflowIds: filters.workflowIds.filter((x) => x !== id) } })
  for (const id of filters.startedBy) active.push({ key: `by:${id}`, label: `Started by: ${labels.person.get(id) ?? id.slice(0, 8)}`, clear: { startedBy: filters.startedBy.filter((x) => x !== id) } })
  for (const id of filters.assigneeIds) active.push({ key: `as:${id}`, label: `Assignee: ${labels.person.get(id) ?? id.slice(0, 8)}`, clear: { assigneeIds: filters.assigneeIds.filter((x) => x !== id) } })
  if (filters.dateFrom || filters.dateTo) {
    const field = DATE_FIELDS.find((d) => d.value === filters.dateField)?.label ?? 'Created'
    active.push({ key: 'date', label: `${field}: ${filters.dateFrom || '…'} – ${filters.dateTo || '…'}`, clear: { dateFrom: '', dateTo: '' } })
  }
  for (const s of filters.sla) active.push({ key: `sla:${s}`, label: `SLA: ${SLA_OPTIONS.find((o) => o.value === s)?.label ?? s}`, clear: { sla: filters.sla.filter((x) => x !== s) } })
  for (const t of filters.triggers) active.push({ key: `tr:${t}`, label: `Trigger: ${TRIGGER_GROUPS.find((g) => g.value === t)?.label ?? t}`, clear: { triggers: filters.triggers.filter((x) => x !== t) } })
  for (const id of filters.versionIds) active.push({ key: `v:${id}`, label: `Version: ${labels.version.get(id) ?? id.slice(0, 8)}`, clear: { versionIds: filters.versionIds.filter((x) => x !== id) } })
  if (filters.hasErrors) active.push({ key: 'errors', label: 'Has errors', clear: { hasErrors: false } })

  function clearAll() {
    setSearchText('')
    replace(clearQueueFilters(filters))
  }

  const advanced = (
    <AdvancedFilters filters={filters} update={update} facets={facets} />
  )

  return (
    <div className="space-y-3">
      {/* View switcher: scrolls sideways rather than overflowing on a phone. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <SegmentedControl<QueueView>
          aria-label="Queue view"
          value={filters.view}
          onValueChange={(view) => update({ view })}
          options={QUEUE_VIEWS.map((v) => ({
            value: v.value,
            text: (
              <span className="inline-flex items-center gap-1.5">
                {v.label}
                {viewCounts && <span className="num text-2xs text-fg-muted">{formatCount(viewCounts[v.value])}</span>}
              </span>
            ),
          }))}
        />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchBar value={searchText} onChange={setSearchText} placeholder="Search workflow, run id, title, step or person…" />
        </div>
        <Button
          variant={advancedOpen || advancedCount > 0 ? 'secondary' : 'ghost'}
          leadingIcon={<SlidersHorizontal />}
          aria-expanded={advancedOpen}
          aria-controls={mobile ? undefined : 'queue-advanced-filters'}
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="shrink-0"
        >
          <span className="max-sm:sr-only">Advanced filters</span>
          {advancedCount > 0 && <CountBadge count={advancedCount} tone="brand" className="ml-1" />}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterChips label="Status" options={chips.map((c) => ({ value: c.value, label: c.label }))} selected={filters.statuses} onChange={(statuses) => update({ statuses })} />
        <SortControls sort={filters.sort} dir={filters.dir} onChange={(sort, dir) => update({ sort, dir })} />
      </div>

      {!mobile && advancedOpen && (
        <div id="queue-advanced-filters" role="region" aria-label="Advanced filters" className="rounded-lg border border-border bg-subtle p-3">
          {advanced}
        </div>
      )}
      {mobile && (
        <Sheet open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <SheetContent side="bottom" title="Advanced filters">
            <DialogBody>{advanced}</DialogBody>
            <DialogFooter>
              {hasQueueFilters(filters) && <Button variant="ghost" onClick={clearAll}>Clear all</Button>}
              <Button onClick={() => setAdvancedOpen(false)}>Done</Button>
            </DialogFooter>
          </SheetContent>
        </Sheet>
      )}

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {active.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => { if (chip.key === 'q') setSearchText(''); update(chip.clear) }}
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-transparent bg-primary-wash px-2.5 text-xs font-medium text-primary-text hover:underline"
              aria-label={`Remove filter ${chip.label}`}
            >
              <span className="truncate">{chip.label}</span>
              <X className="size-3 shrink-0" aria-hidden="true" />
            </button>
          ))}
          <Button variant="link" size="sm" onClick={clearAll}>Clear all</Button>
        </div>
      )}
    </div>
  )
}

function SortControls({ sort, dir, onChange }: { sort: QueueSortField; dir: 'asc' | 'desc'; onChange: (sort: QueueSortField, dir: 'asc' | 'desc') => void }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="mr-1 font-medium text-fg-muted">Sort:</span>
      {([
        { field: 'created_at', label: 'Created' },
        { field: 'started_at', label: 'Started' },
        { field: 'status', label: 'Status' },
      ] as const).map((s) => (
        <Button key={s.field} type="button" size="sm" variant={sort === s.field ? 'secondary' : 'ghost'}
          aria-pressed={sort === s.field}
          onClick={() => onChange(s.field, sort === s.field ? (dir === 'asc' ? 'desc' : 'asc') : 'desc')}
          trailingIcon={sort === s.field ? (dir === 'asc' ? <ArrowUp /> : <ArrowDown />) : undefined}>
          {s.label}
        </Button>
      ))}
    </div>
  )
}

function AdvancedFilters({ filters, update, facets }: { filters: QueueFilters; update: (patch: Partial<QueueFilters>) => void; facets: QueueFacets | null }) {
  const versionOptions = filters.workflowIds.length === 1
    ? (facets?.versions ?? []).filter((v) => v.workflow_id === filters.workflowIds[0]).map((v) => ({ value: v.id, label: `Version ${v.version_number}` }))
    : []
  const loading = !facets
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <FilterField label="Workflow">
        <SearchableMultiOptionPicker
          options={(facets?.workflows ?? []).map((w) => ({ value: w.id, label: w.name }))}
          values={filters.workflowIds}
          placeholder={loading ? 'Loading…' : 'Any workflow'}
          searchPlaceholder="Search workflows…"
          onChange={(workflowIds) => update({ workflowIds })}
          disabled={loading}
        />
      </FilterField>
      <FilterField label="Started by">
        <SearchableMultiOptionPicker
          options={(facets?.starters ?? []).map((p) => ({ value: p.id, label: personLabel(p), subtitle: p.name ? p.email ?? undefined : undefined }))}
          values={filters.startedBy}
          placeholder={loading ? 'Loading…' : 'Anyone'}
          searchPlaceholder="Search people…"
          onChange={(startedBy) => update({ startedBy })}
          disabled={loading}
        />
      </FilterField>
      <FilterField label="Assignee of the waiting task">
        <SearchableMultiOptionPicker
          options={(facets?.assignees ?? []).map((p) => ({ value: p.id, label: personLabel(p), subtitle: p.name ? p.email ?? undefined : undefined }))}
          values={filters.assigneeIds}
          placeholder={loading ? 'Loading…' : 'Anyone'}
          searchPlaceholder="Search people…"
          emptyLabel="No one has a waiting task."
          onChange={(assigneeIds) => update({ assigneeIds })}
          disabled={loading}
        />
      </FilterField>
      <FilterField label="Date" className="sm:col-span-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select size="sm" aria-label="Date field" wrapperClassName="w-28 shrink-0" value={filters.dateField}
            onChange={(e) => update({ dateField: e.target.value as QueueFilters['dateField'] })}
            options={DATE_FIELDS.map((d) => ({ value: d.value, label: d.label }))} />
          <Input size="sm" type="date" aria-label="From date" value={filters.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })} className="w-36 min-w-0" />
          <span className="text-xs text-fg-muted">to</span>
          <Input size="sm" type="date" aria-label="To date" value={filters.dateTo} onChange={(e) => update({ dateTo: e.target.value })} className="w-36 min-w-0" />
        </div>
      </FilterField>
      <FilterField label="Workflow version">
        <SearchableMultiOptionPicker
          options={versionOptions}
          values={filters.versionIds}
          placeholder={filters.workflowIds.length === 1 ? 'Any version' : 'Choose one workflow first'}
          onChange={(versionIds) => update({ versionIds })}
          disabled={filters.workflowIds.length !== 1}
        />
      </FilterField>
      <div className="flex flex-col justify-end gap-3">
        <FilterChips label="SLA" options={SLA_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} selected={filters.sla} onChange={(sla) => update({ sla: sla as QueueSla[] })} />
        <Switch checked={filters.hasErrors} onCheckedChange={(hasErrors) => update({ hasErrors })} label="Has errors" />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <FilterChips label="Trigger" options={TRIGGER_GROUPS.map((g) => ({ value: g.value, label: g.label }))} selected={filters.triggers} onChange={(triggers) => update({ triggers: triggers as QueueTriggerGroup[] })} />
      </div>
    </div>
  )
}

function FilterField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      {children}
    </div>
  )
}
