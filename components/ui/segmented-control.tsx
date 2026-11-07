"use client"

import { useRef, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Tooltip } from "./tooltip"

/**
 * SegmentedControl: 2–5 options for a mode or filter (7/30/90 days,
 * list/grid, Light/Dark). For page views use Tabs. A radiogroup: arrow keys
 * move and select. Icon-only options need `label` (tooltip + aria-label).
 */
export interface SegmentOption<V extends string = string> {
  value: V
  /** Visible text; omit for icon-only and give `label`. */
  text?: ReactNode
  icon?: ReactNode
  /** Accessible name / tooltip for icon-only options. */
  label?: string
  disabled?: boolean
}

export interface SegmentedControlProps<V extends string = string> {
  options: ReadonlyArray<SegmentOption<V>>
  value: V
  onValueChange: (value: V) => void
  size?: "sm" | "md"
  "aria-label": string
  className?: string
}

export function SegmentedControl<V extends string = string>({ options, value, onValueChange, size = "md", className, ...aria }: SegmentedControlProps<V>) {
  const ref = useRef<HTMLDivElement>(null)

  function onKeyDown(e: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
    e.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    const i = enabled.findIndex((o) => o.value === value)
    const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1
    const next = enabled[(i + dir + enabled.length) % enabled.length]
    onValueChange(next.value)
    ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus()
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={aria["aria-label"]}
      onKeyDown={onKeyDown}
      className={cn("inline-flex items-stretch gap-0.5 rounded-md bg-muted p-0.5", size === "sm" ? "h-[max(1.75rem,var(--ds-touch-min))]" : "h-[max(2rem,var(--ds-touch-min))]", className)}
    >
      {options.map((o) => {
        const checked = o.value === value
        const button = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.text == null ? o.label : undefined}
            data-value={o.value}
            data-state={checked ? "on" : "off"}
            disabled={o.disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--ds-radius-sm)-2px)] font-medium",
              size === "sm" ? "px-2 text-xs" : "px-2.5 text-ui",
              o.text == null && (size === "sm" ? "w-[max(1.75rem,calc(var(--ds-touch-min)-4px))] px-0" : "w-[max(2rem,calc(var(--ds-touch-min)-4px))] px-0"),
              "min-w-[calc(var(--ds-touch-min)-4px)]",
              "transition-[color,background-color,box-shadow] duration-[var(--ds-dur-fast)] ease-[var(--ds-ease-standard)]",
              checked ? "bg-panel text-fg shadow-elev-1" : "text-fg-muted hover:text-fg",
              "disabled:cursor-not-allowed disabled:opacity-45",
            )}
          >
            {o.icon != null && <span className="inline-flex [&>svg]:size-4" aria-hidden="true">{o.icon}</span>}
            {o.text}
          </button>
        )
        return o.text == null && o.label ? <Tooltip key={o.value} content={o.label}>{button}</Tooltip> : button
      })}
    </div>
  )
}
