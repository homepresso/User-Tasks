"use client"

import { forwardRef, useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { EmptyState, type EmptyStateProps } from "./empty-state"
import { Skeleton } from "./skeleton"

/**
 * Table styling layer (§3.8): one table look everywhere. Data grids keep their
 * own logic and use these elements / class strings.
 *
 * - Container: bordered panel, radius md, horizontal scroll (TableScroll).
 * - Header: 32px, subtle background, sentence case 12px/500 muted, sticky.
 * - Rows: density row height (40px comfortable), 13px, border-subtle dividers,
 *   hover subtle, selected primary wash with a 2px primary bar. No zebra.
 * - Numbers, currency, durations: <TD numeric> (right-aligned, tabular).
 *
 * Narrow screens: tables never squash their columns. Each column keeps a
 * readable minimum (`col` presets on <TH>, or a table `minWidth`) and the
 * table scrolls sideways inside its own container — swipe, trackpad,
 * shift+wheel, or the arrow keys once the region has focus. Edge shadows show
 * when there is more to scroll. Phones (below md) keep their card layouts.
 */

/**
 * Column presets: a readable minimum width per kind of column, so a table is
 * as wide as its columns need and scrolls instead of crushing them. Put the
 * preset on the column's <TH> (the header sets the column's width); a body
 * cell that truncates (`max-w-0` + `truncate`) then keeps that width.
 */
export const columnClass = {
  /** The item's name / title: 16rem. */
  title: "min-w-64",
  /** A secondary name (process, form, table, owner): 12rem. */
  name: "min-w-48",
  /** Free text (description, notes, URL): 10rem. */
  text: "min-w-40",
  /** People (assignee, members): 10rem. */
  people: "min-w-40 whitespace-nowrap",
  /** Status / type pills: 8rem, one line. */
  status: "min-w-32 whitespace-nowrap",
  /** Dates and times: 8rem, one line. */
  date: "min-w-32 whitespace-nowrap",
  /** Counts, amounts, durations: one line. */
  number: "whitespace-nowrap",
  /** Row actions: as wide as the buttons, never wrapping. */
  actions: "w-px whitespace-nowrap",
} as const
export type ColumnKind = keyof typeof columnClass

/**
 * Keeps `data-scroll-start` / `data-scroll-end` on the frame (shadows on the
 * edge with more to scroll) and `--table-viewport` (the visible width, for
 * rows that should span the view rather than the whole table) in step with
 * the scroll position and size. Writes attributes directly: no re-renders.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const update = useCallback(() => {
    const el = ref.current
    const frame = el?.parentElement
    if (!el || !frame) return
    const max = el.scrollWidth - el.clientWidth
    const x = Math.abs(el.scrollLeft)
    frame.toggleAttribute("data-scroll-start", max > 1 && x > 1)
    frame.toggleAttribute("data-scroll-end", max > 1 && x < max - 1)
    frame.toggleAttribute("data-scrollable", max > 1)
    el.style.setProperty("--table-viewport", `${el.clientWidth}px`)
    // Two sticky columns (a narrow lead column — checkbox, star, handle — then
    // the name): the name sticks just right of the lead column.
    if (frame.getAttribute("data-sticky-first") === "2") {
      const lead = el.querySelector("tr > :first-child:not([colspan])")
      if (lead) el.style.setProperty("--ds-sticky-lead", `${lead.getBoundingClientRect().width}px`)
    }
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    ro?.observe(el)
    if (el.firstElementChild) ro?.observe(el.firstElementChild)
    // Rows arriving later (paging, expanding) change the content width.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(update)
    mo?.observe(el, { childList: true, subtree: true })
    return () => { el.removeEventListener("scroll", update); ro?.disconnect(); mo?.disconnect() }
  }, [update])
  return ref
}

export interface TableScrollProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible name of the scroll region (the list it holds). */
  label?: string
  /** Classes for the outer frame (border, radius, background). */
  frameClassName?: string
  /** Drop the frame border (already inside a Card). */
  bare?: boolean
  /** Keep the first column in view while scrolling sideways (opt-in). */
  stickyFirstColumn?: boolean
  /** With stickyFirstColumn: 2 also keeps a narrow lead column (checkbox, star, drag handle) before the name. */
  stickyColumns?: 1 | 2
}

/**
 * The horizontal scroll region every list uses: focusable (keyboard users
 * scroll with the arrow keys), momentum scrolling, a thin scrollbar and
 * shadow hints on the edge(s) with more content.
 */
export function TableScroll({ label = "Table", frameClassName, bare = false, stickyFirstColumn = false, stickyColumns = 1, className, children, ...props }: TableScrollProps) {
  const ref = useScrollEdges<HTMLDivElement>()
  return (
    <div className={cn("ds-table-frame relative w-full min-w-0", !bare && "rounded-lg border border-border bg-panel", frameClassName)}
      data-sticky-first={stickyFirstColumn ? String(stickyColumns) : undefined}>
      <div ref={ref} role="region" aria-label={label} tabIndex={0}
        className={cn("ds-table-scroll w-full rounded-[inherit]", className)} data-table-scroll {...props}>
        {children}
      </div>
      <span aria-hidden="true" className="ds-table-edge ds-table-edge-start" />
      <span aria-hidden="true" className="ds-table-edge ds-table-edge-end" />
    </div>
  )
}

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Classes for the bordered frame around the scroll region. */
  containerClassName?: string
  /** Drop the container border (table already inside a Card). */
  bare?: boolean
  /** Accessible name of the scroll region (defaults to "Table"). */
  label?: string
  /**
   * The narrowest the table gets before it scrolls sideways (e.g. "52rem").
   * Optional: the columns' own minimums (col presets) usually decide it.
   */
  minWidth?: string
  /** Keep the first column (the item's name) in view while scrolling sideways. */
  stickyFirstColumn?: boolean
  /** 2: the first column is a narrow lead (checkbox, star, handle) and the name is second; both stay in view. */
  stickyColumns?: 1 | 2
}

export const Table = forwardRef<HTMLTableElement, TableProps>(({ className, containerClassName, bare = false, label, minWidth, stickyFirstColumn, stickyColumns, style, ...props }, ref) => (
  <TableScroll label={label ?? (typeof props["aria-label"] === "string" ? props["aria-label"] : undefined)} bare={bare}
    stickyFirstColumn={stickyFirstColumn} stickyColumns={stickyColumns} frameClassName={containerClassName}>
    <table ref={ref} className={cn("w-full border-collapse text-left text-ui text-fg", className)}
      style={minWidth ? { minWidth, ...style } : style} {...props} />
  </TableScroll>
))
Table.displayName = "Table"

export const thClass =
  "sticky top-0 z-[1] h-8 whitespace-nowrap border-b border-border-subtle bg-subtle px-[var(--theme-density-cell-x)] text-left align-middle text-xs font-medium text-fg-muted"

export const tdClass = "h-[var(--theme-density-row-height)] px-[var(--theme-density-cell-x)] align-middle"

export const trClass = cn(
  "border-b border-border-subtle last:border-b-0",
  "transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle",
  "data-[selected=true]:bg-primary-wash data-[selected=true]:shadow-[inset_2px_0_0_var(--theme-primary)]",
)

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn(className)} {...props} />
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn(className)} {...props} />
}

export interface TRProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean
  /** Clickable row: pointer cursor, focusable, Enter activates onClick. */
  interactive?: boolean
}

export const TR = forwardRef<HTMLTableRowElement, TRProps>(({ className, selected, interactive, onKeyDown, ...props }, ref) => (
  <tr
    ref={ref}
    data-selected={selected || undefined}
    aria-selected={selected}
    tabIndex={interactive ? 0 : undefined}
    onKeyDown={interactive ? (e) => {
      onKeyDown?.(e)
      if (e.key === "Enter" && e.target === e.currentTarget) (e.currentTarget as HTMLElement).click()
    } : onKeyDown}
    className={cn(trClass, interactive && "cursor-pointer", "group/row", className)}
    {...props}
  />
))
TR.displayName = "TR"

export interface CellProps {
  /** Right-aligned tabular figures: numbers, currency, durations. */
  numeric?: boolean
  /** The column's kind: a readable minimum width (see columnClass). */
  col?: ColumnKind
}

export function TH({ className, numeric, col, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return <th scope="col" className={cn(thClass, col && columnClass[col], numeric && "text-right", className)} {...props} />
}

export function TD({ className, numeric, col, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return <td className={cn(tdClass, col && columnClass[col], numeric && "num text-right whitespace-nowrap", className)} {...props} />
}

/**
 * One line of text cut with an ellipsis, the whole text in a native tooltip.
 * Use inside a cell whose column has a minimum width (a `col` preset), with
 * `max-w-0` on the cell so the column takes the room that is left.
 */
export function Truncate({ text, className, children }: { text: string | null | undefined; className?: string; children?: React.ReactNode }) {
  return <span className={cn("block truncate", className)} title={text ?? undefined}>{children ?? text}</span>
}

/**
 * A full-width row under a row (expanded details, inline editors): its
 * content stays in view — as wide as the visible region, pinned to its
 * left edge — when the table is scrolled sideways.
 */
export function TableDetailCell({ className, children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...props} className="p-0">
      <div className={cn("ds-table-detail", className)}>{children}</div>
    </td>
  )
}

/** Row actions: hidden until the row is hovered or focused (always visible on touch). */
export function TDActions({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn(tdClass, "w-px whitespace-nowrap text-right", className)} {...props}>
      <div className="inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-[var(--ds-dur-fast)] group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(pointer:coarse)]:opacity-100">
        {props.children}
      </div>
    </td>
  )
}

/** Empty body: an EmptyState sm spanning every column. */
export function TableEmpty({ colSpan, ...props }: { colSpan: number } & EmptyStateProps) {
  return (
    <tr>
      <TableDetailCell colSpan={colSpan}>
        <EmptyState size="sm" {...props} />
      </TableDetailCell>
    </tr>
  )
}

/** Loading body: `rows` skeleton rows at the real row height. */
export function TableSkeleton({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-b border-border-subtle last:border-b-0" aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className={tdClass}>
              <Skeleton className={cn("h-2.5", c === 0 ? "w-3/5" : "w-2/5")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
