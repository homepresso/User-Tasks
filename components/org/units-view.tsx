'use client'

import { useCallback, useMemo, useState } from 'react'
import { Building2, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TBody, TD, THead, TR } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { ChartCanvas } from './chart-canvas'
import { defaultExpanded } from './chart-layout'
import { KindBadge, SortTH, SourceBadge, useSorted } from './shared'
import { TreeList } from './tree-list'
import { flattenTree, parentTree } from './tree-data'
import { personName, type OrgUnitNode, type OrgUnitTreeData } from './types'

/** One org unit on the chart: name, kind, head, headcount. */
export function UnitNode({ unit, selected, onSelect }: { unit: OrgUnitNode; selected?: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(unit.id)} data-unit-node={unit.id}
      className={cn('flex size-full flex-col justify-center gap-1 rounded-lg border bg-panel px-3 text-left shadow-elev-1 hover:border-border-strong',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border-subtle')}>
      <span className="flex items-center gap-1.5">
        <Building2 className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        <span className="truncate text-sm font-semibold text-fg">{unit.name}</span>
        <KindBadge kind={unit.kind} />
      </span>
      <span className="flex items-center justify-between gap-2 text-xs text-fg-muted">
        {unit.head ? (
          <span className="flex min-w-0 items-center gap-1.5"><Avatar name={personName(unit.head)} src={unit.head.avatar_url} size="sm" /><span className="truncate">{personName(unit.head)}</span></span>
        ) : <span className="text-fg-subtle">No head</span>}
        <span className="flex shrink-0 items-center gap-0.5 tabular-nums" title={`${unit.member_count} in this unit · ${unit.headcount} including sub-units`}>
          <Users className="size-3" aria-hidden />{unit.headcount}
        </span>
      </span>
    </button>
  )
}

/** Org units view: a chart (or list / phone tree) of divisions, departments and units. */
export function UnitsView({ data, layout, mobile, selectedId, onSelect }: {
  data: OrgUnitTreeData
  layout: 'chart' | 'list'
  mobile: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const tree = useMemo(() => parentTree(data.units, data.roots), [data])
  const byId = useMemo(() => new Map(data.units.map((u) => [u.id, u])), [data])
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(tree, { levels: 3, maxVisible: 120 }))
  const toggle = useCallback((id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }), [])

  if (!data.units.length) {
    return <EmptyState icon={Building2} title="No org units yet" description="Create divisions and departments under Manage, import them from a CSV, or turn on “Import org structure” for a directory connection." action={{ label: 'Manage organization', href: '/org/manage?tab=units' }} />
  }
  if (layout === 'list') return <UnitsTable data={data} onSelect={onSelect} />
  if (mobile) {
    return <TreeList tree={tree} expanded={expanded} onToggle={toggle} ariaLabel="Org units" renderRow={(id) => {
      const u = byId.get(id)!
      return (
        <button type="button" onClick={() => onSelect(id)} className="flex w-full min-w-0 items-center gap-2 text-left">
          <span className="truncate text-sm font-medium text-fg">{u.name}</span>
          <span className="text-xs capitalize text-fg-muted">{u.kind}</span>
          <span className="ml-auto text-xs tabular-nums text-fg-muted">{u.headcount}</span>
        </button>
      )
    }} />
  }
  return (
    <ChartCanvas ariaLabel="Org units chart" tree={tree} expanded={expanded} onToggle={toggle} selectedId={selectedId}
      toggleLabel={(id, count, open) => `${open ? 'Hide' : 'Show'} ${count} sub-unit${count === 1 ? '' : 's'} of ${byId.get(id)?.name ?? ''}`}
      renderNode={(id) => { const u = byId.get(id); return u ? <UnitNode unit={u} selected={selectedId === id} onSelect={onSelect} /> : null }} />
  )
}

function UnitsTable({ data, onSelect }: { data: OrgUnitTreeData; onSelect: (id: string) => void }) {
  const tree = useMemo(() => parentTree(data.units, data.roots), [data])
  const order = useMemo(() => new Map(flattenTree(tree, 'all').map((r, i) => [r.id, i])), [tree])
  const { sorted, sort, toggle } = useSorted(data.units, {
    tree: (u) => order.get(u.id) ?? 0,
    name: (u) => u.name.toLowerCase(),
    kind: (u) => u.kind,
    head: (u) => (u.head ? personName(u.head) : null),
    headcount: (u) => u.headcount,
  }, 'tree')
  return (
    <Table aria-label="Org units">
      <THead>
        <tr>
          <SortTH label="Unit" column="tree" sort={sort} onSort={toggle} />
          <SortTH label="Kind" column="kind" sort={sort} onSort={toggle} />
          <SortTH label="Head" column="head" sort={sort} onSort={toggle} />
          <SortTH label="Headcount" column="headcount" sort={sort} onSort={toggle} numeric />
        </tr>
      </THead>
      <TBody>
        {sorted.map((u) => (
          <TR key={u.id} interactive onClick={() => onSelect(u.id)}>
            <TD>
              <span className="flex items-center gap-2" style={{ paddingLeft: sort.key === 'tree' ? Math.min(u.depth, 10) * 16 : 0 }}>
                <button type="button" className="font-medium text-fg hover:underline" onClick={(e) => { e.stopPropagation(); onSelect(u.id) }}>{u.name}</button>
                <SourceBadge source={u.source} detached={u.detached} />
              </span>
            </TD>
            <TD className="capitalize">{u.kind}</TD>
            <TD>{u.head ? personName(u.head) : <span className="text-fg-subtle">—</span>}</TD>
            <TD numeric>{u.member_count} / {u.headcount}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}
