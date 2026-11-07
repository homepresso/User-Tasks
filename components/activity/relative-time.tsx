"use client"

import { Tooltip } from "@/components/ui/tooltip"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { cn } from "@/lib/utils"

/**
 * A relative date ("5 min ago", "Yesterday", "27 Oct") with the absolute
 * date and time in a Tooltip (§6 Dates). Tabular figures, so stacked rows align.
 */
export function RelativeTime({ at, className }: { at: string | Date | null | undefined; className?: string }) {
  if (!at) return <span className={cn("text-fg-muted", className)}>—</span>
  const iso = typeof at === "string" ? at : at.toISOString()
  return (
    <Tooltip content={formatAbsolute(iso)}>
      <time dateTime={iso} className={cn("num whitespace-nowrap", className)}>{formatRelative(iso)}</time>
    </Tooltip>
  )
}
