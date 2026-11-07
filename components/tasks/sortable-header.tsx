"use client"

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { TH } from "@/components/ui/table"
import { ariaSortFor, type SortState } from "@/lib/tasks/list-sort"
import { cn } from "@/lib/utils"

/**
 * A sortable column header for the task lists: the header cell carries
 * aria-sort, its label is a button (Enter / Space) that cycles ascending →
 * descending → none (lib/tasks/list-sort nextSort). The arrow shows the
 * direction; an idle column shows a faint up/down hint on hover / focus.
 */
export function SortableTH<K extends string>({ sortKey, sort, onSort, children, numeric, className, label }: {
  sortKey: K
  sort: SortState<K> | null
  onSort: (key: K) => void
  children: React.ReactNode
  numeric?: boolean
  className?: string
  /** Accessible column name when `children` isn't plain text. */
  label?: string
}) {
  const ariaSort = ariaSortFor(sort, sortKey)
  return (
    <TH numeric={numeric} className={className} aria-sort={ariaSort} data-sort-key={sortKey}>
      <SortButton sortKey={sortKey} sort={sort} onSort={onSort} numeric={numeric} label={label}>{children}</SortButton>
    </TH>
  )
}

/** The header's button (also used by list headers that aren't tables, e.g. Home). */
export function SortButton<K extends string>({ sortKey, sort, onSort, children, numeric, label, className }: {
  sortKey: K
  sort: SortState<K> | null
  onSort: (key: K) => void
  children: React.ReactNode
  numeric?: boolean
  label?: string
  className?: string
}) {
  const ariaSort = ariaSortFor(sort, sortKey)
  const name = label ?? (typeof children === "string" ? children : sortKey)
  const next = ariaSort === "none" ? "ascending" : ariaSort === "ascending" ? "descending" : "unsorted"
  const Icon = ariaSort === "ascending" ? ArrowUp : ariaSort === "descending" ? ArrowDown : ChevronsUpDown
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSort(sortKey) }}
      aria-label={`${name}: sort ${next}`}
      title={`Sort by ${name.toLowerCase()}`}
      className={cn(
        "group/sort -mx-1 inline-flex items-center gap-1 rounded-sm px-1 font-medium hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--theme-primary)]",
        ariaSort !== "none" && "text-fg",
        numeric && "flex-row-reverse",
        className,
      )}
      data-sort-button={sortKey}
      data-sort-dir={ariaSort === "none" ? undefined : ariaSort}
    >
      <span>{children}</span>
      <Icon
        className={cn("size-3 shrink-0", ariaSort === "none" && "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60")}
        aria-hidden="true"
      />
    </button>
  )
}
