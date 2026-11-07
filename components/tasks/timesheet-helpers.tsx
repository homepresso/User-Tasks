"use client"

import { Badge, type Tone } from "@/components/ui/badge"

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

export interface BadgeConfig {
  label: string
  /** Semantic tone of the badge; neutral for "no effort yet". */
  tone: Tone
  /** Emphasised (call to action / done): a pill with a status dot. */
  ring?: boolean
}

export function getEffortBadge(status: string, priority: string): BadgeConfig {
  if (status === "completed" || status === "cancelled") {
    return { label: "W", tone: "success", ring: true }
  }
  if (status === "blocked") {
    return { label: "Blocked", tone: "danger" }
  }
  if (status === "in_progress") {
    if (priority === "critical" || priority === "high") {
      return { label: "Heaps", tone: "warning" }
    }
    return { label: "A bit", tone: "warning" }
  }
  // todo or unknown
  return { label: "—", tone: "neutral" }
}

export function EffortBadge({ config }: { config: BadgeConfig }) {
  if (config.label === "—") {
    return <span className="text-ui text-fg-subtle">—</span>
  }
  return <Badge tone={config.tone} pill={config.ring} dot={config.ring}>{config.label}</Badge>
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
