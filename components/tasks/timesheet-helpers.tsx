"use client"

import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"

/* ── Week range helpers ── */

export function getWeekRange(referenceDate: Date) {
  const d = new Date(referenceDate)
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { start: monday, end: sunday }
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

export function formatWeekRange(start: Date, end: Date) {
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} - ${end.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()} ${MONTHS[start.getMonth()]} - ${end.getDate()} ${MONTHS[end.getMonth()]} ${start.getFullYear()}`
  }
  return `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()} - ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
}

export function formatDateShort(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getMonth()]}`
}

/* ── Task code generator ── */

export function getTaskCode(task: { id: string; tenant?: { slug?: string } | null }) {
  const prefix = task.tenant?.slug
    ? task.tenant.slug.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase()
    : "TSK"
  const suffix = task.id.replace(/-/g, "").slice(-5).toUpperCase()
  return `${prefix}${suffix}`
}

/* ── Effort / status badge ── */

interface BadgeConfig {
  label: string
  bg: string
  text: string
  ring?: boolean
}

export function getEffortBadge(status: string, priority: string): BadgeConfig {
  if (status === "completed" || status === "cancelled") {
    return { label: "W", bg: "bg-green-600", text: "text-white", ring: true }
  }
  if (status === "blocked") {
    return { label: "Blocked", bg: "bg-red-100", text: "text-red-700" }
  }
  if (status === "in_progress") {
    if (priority === "critical" || priority === "high") {
      return { label: "Heaps", bg: "bg-yellow-400", text: "text-yellow-900" }
    }
    return { label: "A Bit", bg: "bg-yellow-300", text: "text-yellow-800" }
  }
  // todo or unknown
  return { label: "—", bg: "", text: "text-gray-400" }
}

export function getQueueBadge(task: { is_workflow_task?: boolean; status?: string }): BadgeConfig {
  if (task.is_workflow_task) {
    return { label: "Action", bg: "bg-purple-600", text: "text-white", ring: true }
  }
  return { label: "Pending", bg: "bg-yellow-300", text: "text-yellow-800" }
}

export function EffortBadge({ config }: { config: BadgeConfig }) {
  if (config.label === "—") {
    return <span className="text-sm text-gray-400">—</span>
  }
  if (config.ring) {
    return (
      <span className={cn(
        // min-w (not a fixed width) keeps one-letter labels circular and
        // lets longer ones ("Action") grow into a pill instead of clipping.
        "inline-flex h-8 min-w-8 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2 text-xs font-bold",
        config.bg, config.text
      )}>
        {config.label}
      </span>
    )
  }
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold",
      config.bg, config.text
    )}>
      {config.label}
    </span>
  )
}

/* ── Week navigation header ── */

interface WeekNavProps {
  weekOffset: number
  onWeekChange: (offset: number) => void
  start: Date
  end: Date
  viewMode: "day" | "week"
  onViewModeChange: (mode: "day" | "week") => void
  effortMode: boolean
  onEffortModeChange: (v: boolean) => void
}

export function WeekNav({
  weekOffset, onWeekChange, start, end,
  viewMode, onViewModeChange,
  effortMode, onEffortModeChange,
}: WeekNavProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onWeekChange(weekOffset - 1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          style={{ color: "var(--theme-muted-text)" }}
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-medium min-w-[220px] text-center" style={{ color: "var(--theme-card-text)" }}>
          {formatWeekRange(start, end)}
        </span>
        <button
          onClick={() => onWeekChange(weekOffset + 1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          style={{ color: "var(--theme-muted-text)" }}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        {/* Day / Week toggle */}
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--theme-surface-border)" }}>
          {(["day", "week"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onViewModeChange(m)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                viewMode === m
                  ? "text-[color:var(--theme-on-accent)]"
                  : "hover:bg-gray-50"
              )}
              style={viewMode === m ? { backgroundColor: "var(--theme-accent)" } : { color: "var(--theme-muted-text)" }}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Effort / Time toggle */}
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--theme-muted-text)" }}>
          <span className={cn(!effortMode && "font-semibold", !effortMode && "text-gray-900")}>
            Time
          </span>
          <button
            onClick={() => onEffortModeChange(!effortMode)}
            className={cn(
              "relative w-10 h-5 rounded-full transition-colors",
              effortMode ? "bg-purple-500" : "bg-gray-300"
            )}
          >
            <span className={cn(
              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
              effortMode ? "left-5.5" : "left-0.5"
            )} />
          </button>
          <span className={cn(effortMode && "font-semibold", effortMode && "text-gray-900")}>
            Effort
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Table header ── */

interface TableHeaderProps {
  dateLabel: string
  viewMode: "day" | "week"
  weekDays?: { label: string; date: Date }[]
}

export function TimesheetTableHeader({ dateLabel, viewMode, weekDays }: TableHeaderProps) {
  if (viewMode === "week" && weekDays) {
    return (
      <div
        className="grid text-xs font-semibold"
        style={{
          gridTemplateColumns: `minmax(280px, 2fr) repeat(${weekDays.length}, 80px) minmax(180px, 1fr) 36px`,
          backgroundColor: "var(--theme-accent, #1B2A4A)",
          color: "var(--theme-on-accent, #FFFFFF)",
        }}
      >
        <div className="px-4 py-3">Task</div>
        {weekDays.map((d, i) => (
          <div
            key={i}
            className="px-2 py-3 text-center"
            style={{
              backgroundColor: isToday(d.date) ? "#7C3AED" : undefined,
              color: isToday(d.date) ? "#FFFFFF" : undefined,
            }}
          >
            {d.label}
          </div>
        ))}
        <div className="px-4 py-3">Notes</div>
        <div />
      </div>
    )
  }

  return (
    <div
      className="grid text-xs font-semibold"
      style={{
        gridTemplateColumns: "minmax(280px, 2fr) 120px minmax(180px, 1fr) 36px",
        backgroundColor: "var(--theme-accent, #1B2A4A)",
        color: "var(--theme-on-accent, #FFFFFF)",
      }}
    >
      <div className="px-4 py-3">Task</div>
      <div className="px-4 py-3 text-center" style={{ backgroundColor: "#7C3AED", color: "#FFFFFF" }}>
        Due Date
      </div>
      <div className="px-4 py-3">Notes</div>
      <div />
    </div>
  )
}

function isToday(date: Date) {
  const now = new Date()
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  )
}

export function getWeekDays(start: Date) {
  const days: { label: string; date: Date }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push({ label: formatDateShort(d), date: d })
  }
  return days
}
