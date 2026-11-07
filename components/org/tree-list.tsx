'use client'

import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ChartTree } from './chart-layout'
import { flattenTree } from './tree-data'

/**
 * Indented, collapsible list of a chart tree — the phone layout of the
 * charts and an accessible tree (role="tree"). Only expanded branches render.
 */
export function TreeList({ tree, expanded, onToggle, renderRow, ariaLabel, maxRows = 500 }: {
  tree: ChartTree
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
  renderRow: (id: string) => ReactNode
  ariaLabel: string
  maxRows?: number
}) {
  const rows = flattenTree(tree, expanded)
  const shown = rows.slice(0, maxRows)
  return (
    <div className="rounded-lg border border-border-subtle bg-panel">
      <ul role="tree" aria-label={ariaLabel} className="divide-y divide-border-subtle">
        {shown.map(({ id, depth }) => {
          const count = tree.childrenOf.get(id)?.length ?? 0
          const open = expanded.has(id)
          return (
            <li key={id} role="treeitem" aria-level={depth + 1} aria-expanded={count ? open : undefined} aria-selected={false}
              className="flex items-center gap-1 py-1.5 pr-2" style={{ paddingLeft: 8 + Math.min(depth, 12) * 16 }}>
              {count ? (
                <button type="button" onClick={() => onToggle(id)} className="flex size-7 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-subtle hover:text-fg"
                  aria-label={`${open ? 'Collapse' : 'Expand'} (${count})`}>
                  {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                </button>
              ) : <span className="size-7 shrink-0" aria-hidden />}
              <div className="min-w-0 flex-1">{renderRow(id)}</div>
              {count > 0 && <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{count}</span>}
            </li>
          )
        })}
      </ul>
      {rows.length > shown.length && <p className="px-3 py-2 text-xs text-fg-muted">{rows.length - shown.length} more — collapse a branch or search to narrow down.</p>}
    </div>
  )
}
