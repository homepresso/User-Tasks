"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useWorkspaceTheme } from "@/components/providers/theme-provider"
import { resolveSlotsDetailed, type ChartTheme, type ResolvedSlot, type SlotRequest } from "@/lib/home/chart-palette"
import { formatCount, formatShare } from "@/lib/home/activity"
import { LegendItem } from "./chart-card"
import { floatingSurfaceClass } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/** The workspace theme's colours for charts (the active light / dark palette). */
export function useChartTheme(): ChartTheme {
  const { palette } = useWorkspaceTheme()
  return useMemo(() => ({
    card: palette.cardBg, primary: palette.primary, accent: palette.accent, chart: palette.chart, success: palette.success, warning: palette.warning, danger: palette.danger, muted: palette.mutedText,
  }), [palette])
}

/** resolveSlots for this theme, memoised on the slot list's shape. */
export function useSlotsDetailed(slots: SlotRequest[]): ResolvedSlot[] {
  const theme = useChartTheme()
  const key = JSON.stringify(slots)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised slots
  return useMemo(() => resolveSlotsDetailed(slots, theme), [key, theme])
}

export function useSlots(slots: SlotRequest[]): string[] {
  return useSlotsDetailed(slots).map((s) => s.color)
}

export interface Segment { key: string; label: string; value: number; color: string; icon?: ReactNode }

/**
 * One whole split into parts (the dataviz segmented bar, §5.1): 8px tall,
 * 2px gaps, radius 2px on the outer ends only. Labels sit below as a legend
 * (12px: a dot, the label, a tabular value). Every part is focusable and
 * shows its name, count and share on hover / focus. `legend="line"` keeps
 * the legend to one line (a collapsed top card); `false` leaves it out.
 */
export function SegmentedBar({ segments, total, locale, label, legend = true }: { segments: Segment[]; total: number; locale?: string; label: string; legend?: boolean | "line" }) {
  const [active, setActive] = useState<string | null>(null)
  const parts = segments.filter((s) => s.value > 0)
  const current = parts.find((p) => p.key === active) ?? null
  return (
    <div className="min-w-0">
      <div className="relative">
        <div className="flex h-2 w-full gap-[2px]" role="list" aria-label={label} data-segmented-bar>
          {parts.map((s, i) => {
            const share = total > 0 ? s.value / total : 0
            return (
              <div key={s.key} role="listitem" tabIndex={0}
                aria-label={`${s.label}: ${formatCount(s.value, locale)} (${formatShare(share, locale)})`}
                onPointerEnter={() => setActive(s.key)} onPointerLeave={() => setActive((a) => (a === s.key ? null : a))}
                onFocus={() => setActive(s.key)} onBlur={() => setActive((a) => (a === s.key ? null : a))}
                className={cn("min-w-[4px] transition-[filter] duration-[var(--ds-dur-fast)] hover:brightness-110",
                  i === 0 && "rounded-l-[2px]", i === parts.length - 1 && "rounded-r-[2px]")}
                // Series colours are data-driven (the theme palette resolver), so they stay inline.
                style={{ flexGrow: s.value, flexBasis: 0, backgroundColor: s.color }}
                data-segment={s.key} />
            )
          })}
          {parts.length === 0 && <div className="flex-1 rounded-[2px] bg-muted" aria-hidden />}
        </div>
        {current && (
          <div role="status" className={cn(floatingSurfaceClass, "pointer-events-none absolute left-0 top-full z-20 mt-1.5 px-2 py-1 text-xs")}>
            <span className="num font-medium">{formatCount(current.value, locale)}</span>
            <span className="text-fg-muted"> · {formatShare(total > 0 ? current.value / total : 0, locale)} · {current.label}</span>
          </div>
        )}
      </div>
      {legend && (
        <ul className={cn("mt-2 flex gap-x-3 gap-y-1", legend === "line" ? "h-4 flex-wrap overflow-hidden" : "flex-wrap")} aria-hidden data-segment-legend>
          {segments.map((s) => (
            <LegendItem key={s.key} color={s.color} label={s.label} value={formatCount(s.value, locale)} icon={s.icon} />
          ))}
        </ul>
      )}
    </div>
  )
}
