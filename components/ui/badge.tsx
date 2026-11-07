import { cn } from "@/lib/utils"

/**
 * One semantic tone set for every pill, chip and count (§3.7). Colour carries
 * meaning only: never decorate with a tone.
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand"

export const TONE_CLASSES: Record<Tone, { bg: string; text: string; dot: string }> = {
  neutral: { bg: "bg-muted", text: "text-fg-muted", dot: "bg-fg-subtle" },
  info: { bg: "bg-info-wash", text: "text-info", dot: "bg-info" },
  success: { bg: "bg-success-wash", text: "text-success", dot: "bg-success" },
  warning: { bg: "bg-warning-wash", text: "text-warning", dot: "bg-warning" },
  danger: { bg: "bg-danger-wash", text: "text-danger", dot: "bg-danger" },
  brand: { bg: "bg-primary-wash", text: "text-primary-text", dot: "bg-primary" },
}

/** Status → tone (workflows, runs, tasks, integrations, agents). Unknown statuses are neutral. */
export const STATUS_TONE: Record<string, Tone> = {
  todo: "neutral", draft: "neutral", cancelled: "neutral", canceled: "neutral", inactive: "neutral", archived: "neutral", disabled: "neutral", pending: "neutral", queued: "neutral",
  in_progress: "info", running: "info", processing: "info",
  waiting_for_event: "warning", awaiting_approval: "warning", paused: "warning", warning: "warning",
  blocked: "danger", failed: "danger", error: "danger", overdue: "danger", breached: "danger",
  completed: "success", done: "success", active: "success", published: "success", success: "success", succeeded: "success", enabled: "success",
  migrated: "brand",
}

export function statusTone(status: string | null | undefined): Tone {
  return STATUS_TONE[String(status ?? "").toLowerCase()] ?? "neutral"
}

/** "in_progress" → "In progress" (sentence case). */
export function statusLabel(status: string): string {
  const s = status.replace(/[_-]+/g, " ").trim()
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  /** Leading 6px dot in the tone colour. */
  dot?: boolean
  /** Fully rounded (StatusPill) vs radius xs (Badge). */
  pill?: boolean
}

/** Small tinted label: 20px, 12px/500, no border. */
export function Badge({ tone = "neutral", dot = false, pill = false, className, children, ...props }: BadgeProps) {
  const t = TONE_CLASSES[tone]
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex h-5 w-fit max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap px-1.5 text-xs font-medium",
        pill ? "rounded-full" : "rounded-sm",
        t.bg, t.text, className,
      )}
      {...props}
    >
      {dot && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />}
      <span className="truncate">{children}</span>
    </span>
  )
}

export interface StatusPillProps extends Omit<BadgeProps, "tone" | "children"> {
  status: string
  /** Overrides the mapped tone. */
  tone?: Tone
  /** Overrides the derived label. */
  label?: React.ReactNode
}

/** Status pill: dot + sentence-case label in the status's tone. */
export function StatusPill({ status, tone, label, ...props }: StatusPillProps) {
  return <Badge pill dot tone={tone ?? statusTone(status)} data-status={status} {...props}>{label ?? statusLabel(status)}</Badge>
}

/** User label (finance, kyc) or version ("v2", pass mono). Bordered, neutral. */
export function Tag({ className, mono = false, ...props }: React.HTMLAttributes<HTMLSpanElement> & { mono?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit max-w-full shrink-0 items-center gap-1 truncate whitespace-nowrap rounded-sm border border-border bg-panel px-1.5 text-xs text-fg-muted",
        mono && "font-mono text-2xs",
        className,
      )}
      {...props}
    />
  )
}

/** Count after a nav item, tab or heading: neutral unless it means overdue / failed. */
export function CountBadge({ count, tone = "neutral", max = 99, className, ...props }: Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> & {
  count: number
  tone?: "neutral" | "danger" | "brand"
  max?: number
}) {
  const t = TONE_CLASSES[tone]
  return (
    <span
      className={cn("num inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-2xs font-semibold", t.bg, t.text, className)}
      {...props}
    >
      {count > max ? `${max}+` : count}
    </span>
  )
}
