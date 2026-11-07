'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { ChartCanvas } from './chart-canvas'
import { defaultExpanded, expandPathTo } from './chart-layout'
import { PersonNode } from './person-node'
import { PersonSearch } from './person-search'
import { TreeList } from './tree-list'
import { peopleTree } from './tree-data'
import { personName, type ChartPerson } from './types'

/**
 * People view, chart layout: the reporting-line org chart (roots and two
 * levels open, at most ~150 cards to start), search to focus a person,
 * "Me", expand / collapse all. On phones it is an indented list.
 */
export function PeopleChart({ people, roots, meId, selectedId, onSelect, mobile }: {
  people: ChartPerson[]
  roots: string[]
  meId: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  mobile: boolean
}) {
  const tree = useMemo(() => peopleTree(people, roots), [people, roots])
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(tree))
  const [centre, setCentre] = useState<{ id: string; nonce: number } | null>(null)

  const toggle = useCallback((id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }), [])

  const focus = useCallback((id: string, select = true) => {
    setExpanded((prev) => expandPathTo(prev, tree.parentOf, id))
    setCentre({ id, nonce: Date.now() })
    if (select) onSelect(id)
  }, [tree.parentOf, onSelect])

  const expandAll = () => setExpanded(new Set(tree.childrenOf.keys()))
  const collapseAll = () => setExpanded(new Set())

  const toolbar = (
    <>
      <PersonSearch people={people} onPick={(id) => focus(id)} className="w-56 sm:w-64" />
      {meId && byId.has(meId) && <Button size="sm" variant="secondary" leadingIcon={<LocateFixed />} onClick={() => focus(meId, false)}>Me</Button>}
      <Button size="sm" variant="ghost" leadingIcon={<ChevronsUpDown />} onClick={expandAll}>Expand all</Button>
      <Button size="sm" variant="ghost" leadingIcon={<ChevronsDownUp />} onClick={collapseAll}>Collapse</Button>
    </>
  )

  if (mobile) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        <TreeList tree={tree} expanded={expanded} onToggle={toggle} ariaLabel="Org chart"
          renderRow={(id) => {
            const p = byId.get(id)
            if (!p) return null
            return (
              <button type="button" onClick={() => onSelect(id)} className="flex w-full min-w-0 items-center gap-2 text-left">
                <Avatar name={personName(p)} src={p.avatar_url} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{personName(p)}{id === meId ? ' (you)' : ''}</span>
                  {p.job_title && <span className="block truncate text-xs text-fg-muted">{p.job_title}</span>}
                </span>
              </button>
            )
          }} />
      </div>
    )
  }

  return (
    <ChartCanvas
      ariaLabel="Org chart"
      tree={tree}
      expanded={expanded}
      onToggle={toggle}
      centre={centre}
      selectedId={selectedId}
      toolbar={toolbar}
      toggleLabel={(id, count, open) => `${open ? 'Hide' : 'Show'} ${count} direct report${count === 1 ? '' : 's'} of ${personName(byId.get(id))}`}
      renderNode={(id) => {
        const p = byId.get(id)
        return p ? <PersonNode person={p} selected={selectedId === id} isMe={id === meId} onSelect={onSelect} /> : null
      }}
    />
  )
}
