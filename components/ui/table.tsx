"use client"

import { forwardRef } from "react"
import { cn } from "@/lib/utils"
import { EmptyState, type EmptyStateProps } from "./empty-state"
import { Skeleton } from "./skeleton"

/**
 * Table styling layer (§3.8): one table look everywhere. Data grids keep their
 * own logic and use these elements / class strings.
 *
 * - Container: bordered panel, radius md, horizontal scroll.
 * - Header: 32px, subtle background, sentence case 12px/500 muted, sticky.
 * - Rows: density row height (40px comfortable), 13px, border-subtle dividers,
 *   hover subtle, selected primary wash with a 2px primary bar. No zebra.
 * - Numbers, currency, durations: <TD numeric> (right-aligned, tabular).
 */
export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Classes for the bordered scroll container. */
  containerClassName?: string
  /** Drop the container border (table already inside a Card). */
  bare?: boolean
}

// Phones: a truncating name cell (`max-w-0`) keeps 10rem, so the name stays
// readable and the table scrolls inside its container instead of crushing it.
export const Table = forwardRef<HTMLTableElement, TableProps>(({ className, containerClassName, bare = false, ...props }, ref) => (
  <div className={cn("relative w-full overflow-x-auto overscroll-x-contain max-sm:[&_td.max-w-0]:min-w-40", !bare && "rounded-lg border border-border bg-panel", containerClassName)}>
    <table ref={ref} className={cn("w-full border-collapse text-left text-ui text-fg", className)} {...props} />
  </div>
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
}

export function TH({ className, numeric, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return <th scope="col" className={cn(thClass, numeric && "text-right", className)} {...props} />
}

export function TD({ className, numeric, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return <td className={cn(tdClass, numeric && "num text-right", className)} {...props} />
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
      <td colSpan={colSpan}>
        <EmptyState size="sm" {...props} />
      </td>
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
