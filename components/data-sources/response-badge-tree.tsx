'use client'

/**
 * A test response as a tree of draggable badges (lib/data-sources/api-rows
 * responseBadges): lists show "invoices · 6 rows" (the most likely one marked
 * "best match"), lists inside a row "lines · items (per row)", objects and
 * fields their name with a type icon and an example. Drag a badge onto a drop
 * zone, or click it for the same actions as a menu (keyboard and touch).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type { SchemaNode } from '@/lib/response-schema'
import { BADGE_ACTION_LABELS, badgeActions, encodeBadgeDrag, responseBadges, type BadgeAction, type ResponseBadge } from '@/lib/data-sources/api-rows'
import { DataChip } from './data-chip'

function matches(b: ResponseBadge, q: string): boolean {
  return b.name.toLowerCase().includes(q) || b.children.some((c) => matches(c, q))
}

/** Badges open by default: the way to the chosen rows (or the best match) and their fields. */
function initialOpen(root: ResponseBadge, focus: string | null): Set<string> {
  const out = new Set<string>([root.path])
  if (focus === null) return out
  const walk = (b: ResponseBadge, trail: string[]): boolean => {
    if (b.path === focus) { trail.forEach((p) => out.add(p)); out.add(b.path); return true }
    return b.children.some((c) => walk(c, [...trail, b.path]))
  }
  walk(root, [])
  return out
}

function BadgeMenu({ actions, onPick, onClose, labelledBy }: { actions: BadgeAction[]; onPick: (a: BadgeAction) => void; onClose: () => void; labelledBy: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus() }, [])
  return (
    <div ref={ref} role="menu" aria-label={labelledBy} className="mt-1 flex flex-wrap gap-1"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault()
          const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
          const i = items.indexOf(document.activeElement as HTMLButtonElement)
          items[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus()
        }
      }}>
      {actions.map((a) => (
        <button key={a} type="button" role="menuitem" onClick={() => { onPick(a); onClose() }} data-badge-action={a}
          className="rounded border px-1.5 py-0.5 text-2xs font-medium border-primary text-primary-text hover:bg-primary-wash">{BADGE_ACTION_LABELS[a]}</button>
      ))}
      <button type="button" role="menuitem" onClick={onClose} className="rounded px-1.5 py-0.5 text-2xs text-fg-muted">Cancel</button>
    </div>
  )
}

export function ResponseBadgeTree({ root, sample, rowsPath, mode, onAction, maxHeight = 280 }: {
  root: SchemaNode
  sample: unknown
  /** The rows in use ('' = the response itself; null = none yet). */
  rowsPath: string | null
  mode: 'rows' | 'options'
  onAction: (action: BadgeAction, badge: ResponseBadge) => void
  maxHeight?: number
}) {
  const tree = useMemo(() => responseBadges(root, sample, rowsPath), [root, sample, rowsPath])
  // Open: the way to the rows in use (or the best match), unless the designer folded it; anything they unfolded.
  const auto = useMemo(() => initialOpen(tree, rowsPath ?? findRecommended(tree)), [tree, rowsPath])
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map())
  const open = { has: (p: string) => toggled.get(p) ?? auto.has(p) }
  const [menu, setMenu] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const toggle = (p: string) => setToggled((cur) => new Map(cur).set(p, !(cur.get(p) ?? auto.has(p))))

  const render = (b: ResponseBadge): React.ReactNode => {
    if (q && !matches(b, q)) return null
    const expandable = b.children.length > 0
    const isOpen = q ? true : open.has(b.path)
    const actions = badgeActions(b, mode)
    const isRoot = b.depth === 0
    const showChip = !isRoot || b.kind === 'rows'
    return (
      <li key={b.path || '$'} role="treeitem" aria-expanded={expandable ? isOpen : undefined} aria-selected={b.selected || undefined} aria-level={b.depth + 1}>
        <div className="flex min-w-0 items-center gap-1 py-0.5" style={{ paddingLeft: 2 + b.depth * 12 }}>
          {expandable
            ? <button type="button" className="rounded p-0.5 text-fg-muted" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${b.name}`} onClick={() => toggle(b.path)}>{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
            : <span className="inline-block w-[19px] shrink-0" aria-hidden />}
          {showChip
            ? <DataChip icon={b.icon} label={b.label} testId={b.path || '$'} selected={b.selected} recommended={b.recommended}
                muted={!actions.length && !b.selected}
                title={b.kind === 'sublist' ? `${b.name}: a list inside each row — use it to get one row per item` : b.rowPath ? `${b.rowPath}${b.example ? ` · e.g. ${b.example}` : ''}` : b.label}
                payload={actions.length ? encodeBadgeDrag(b) : undefined}
                onActivate={actions.length ? () => setMenu(menu === b.path ? null : b.path) : undefined}
                menuOpen={menu === b.path} />
            : <span className="text-2xs text-fg-muted">The whole response</span>}
          {b.example !== undefined && <span className="min-w-0 truncate font-mono text-2xs text-fg-muted">{b.example}</span>}
          {b.selected && <span className="shrink-0 text-2xs font-medium text-primary-text">rows in use</span>}
        </div>
        {menu === b.path && actions.length > 0 && (
          <div style={{ paddingLeft: 23 + b.depth * 12 }}>
            <BadgeMenu actions={actions} labelledBy={`${b.label}: actions`} onPick={(a) => onAction(a, b)} onClose={() => { setMenu(null); document.querySelector<HTMLElement>(`[data-response-badge="${CSS.escape(b.path || '$')}"]`)?.focus() }} />
          </div>
        )}
        {expandable && isOpen && <ul role="group">{b.children.map(render)}</ul>}
      </li>
    )
  }

  return (
    <div className="min-w-0 space-y-1" data-testid="response-badge-tree">
      <label className="relative block">
        <span className="sr-only">Search the response</span>
        <Search size={11} className="pointer-events-none absolute left-2 top-2 text-fg-muted" aria-hidden />
        <input className="h-7 w-full min-w-0 rounded border border-border bg-panel pl-6 pr-2 text-2xs outline-none focus-visible:ring-2 focus-visible:ring-primary" placeholder="Find a field…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul role="tree" aria-label="The API's response" className="overflow-y-auto rounded border border-border px-1 py-0.5" style={{ maxHeight, contain: 'inline-size' }}>
        {render(tree)}
      </ul>
    </div>
  )
}

function findRecommended(b: ResponseBadge): string | null {
  if (b.recommended) return b.path
  for (const c of b.children) { const r = findRecommended(c); if (r !== null) return r }
  return null
}
