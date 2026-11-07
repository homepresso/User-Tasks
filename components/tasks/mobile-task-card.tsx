"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * A task as a card, for phones: the task lists (My tasks, the Task tracker,
 * My team) swap their table rows for these below `md`.
 *
 *   [leading]  Title, two lines max (opens the task)          [actions]
 *              KEY · meta
 *              [status] [priority] [progress]                    due
 *              [footer: queue buttons, badges]
 *
 * The title link stretches over the whole card, so tapping anywhere opens
 * the task; `leading`, `actions` and `footer` sit above it and stay tappable.
 * `as="tr"` renders it as one full-width table row (the trackers keep their
 * <table> and group header rows).
 */
export function MobileTaskCard({
  as = "li", colSpan, href, title, code, done = false, meta, status, priority, progress, due, footer, leading, actions, className, ...data
}: {
  as?: "li" | "tr"
  /** Columns to span when `as="tr"`. */
  colSpan?: number
  href: string
  title: string
  code?: ReactNode
  done?: boolean
  meta?: ReactNode
  status?: ReactNode
  priority?: ReactNode
  progress?: ReactNode
  due?: ReactNode
  footer?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  className?: string
} & Record<`data-${string}`, string | boolean | undefined>) {
  const body = (
    <>
      <div className="flex items-start gap-2">
        {leading != null && <span className="relative z-[1] -ml-1 -mt-1 shrink-0">{leading}</span>}
        <div className="min-w-0 flex-1">
          <Link href={href} className="block rounded-sm after:absolute after:inset-0 after:content-['']" aria-label={`Open ${title}`}>
            <span className={cn("line-clamp-2 text-sm font-medium text-fg [overflow-wrap:anywhere]", done && "text-fg-muted line-through")}>{title}</span>
          </Link>
          {(code != null || meta != null) && (
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
              {code != null && <span className="shrink-0 font-mono">{code}</span>}
              {code != null && meta != null && <span aria-hidden="true">·</span>}
              {meta != null && <span className="truncate">{meta}</span>}
            </p>
          )}
        </div>
        {actions != null && <span className="relative z-[1] -mr-1 -mt-1 flex shrink-0 items-center">{actions}</span>}
      </div>
      <div className={cn("mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs", leading != null && "pl-9")}>
        {status}
        {priority}
        {progress}
        {due != null && <span className="ml-auto">{due}</span>}
      </div>
      {footer != null && <div className={cn("relative z-[1] mt-2 flex min-w-0 flex-wrap items-center gap-2 [&>*]:max-w-full", leading != null && "pl-9")}>{footer}</div>}
    </>
  )
  const cls = cn("@container relative px-3 py-3", className)
  if (as === "tr") {
    // max-w-0: the card takes the table's width instead of widening it.
    return (
      <tr className="border-b border-border-subtle last:border-b-0" {...data}>
        <td colSpan={colSpan} className="w-full max-w-0 p-0"><div className={cls}>{body}</div></td>
      </tr>
    )
  }
  return <li className={cls} {...data}>{body}</li>
}
