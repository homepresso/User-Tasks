"use client"

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { CountBadge } from "./badge"

/**
 * Tabs: switch between views of one page (navigation). For filters and
 * modes use SegmentedControl. 36px, 13px/500, a 2px primary underline on the
 * active tab; labels never wrap — the row scrolls with faded edges.
 * Roving tabindex + arrow keys / Home / End.
 *
 * Controlled: render the panel for `value` yourself, or use TabPanel with
 * the same `idBase` to get the aria wiring.
 */
export interface TabItem<V extends string = string> {
  value: V
  label: ReactNode
  /** Neutral count after the label ("Rows 32"). */
  count?: number
  icon?: ReactNode
  disabled?: boolean
  /** Render as a link (tabs that change the URL). */
  href?: string
}

export interface TabsProps<V extends string = string> {
  items: ReadonlyArray<TabItem<V>>
  value: V
  onValueChange?: (value: V) => void
  "aria-label"?: string
  className?: string
  /** Shared id prefix for TabPanel wiring. */
  idBase?: string
  /** Bottom hairline across the full width (default true). */
  bordered?: boolean
  /** Renders a link element for `href` items (e.g. next/link). Defaults to <a>. */
  linkAs?: React.ElementType
}

export function Tabs<V extends string = string>({ items, value, onValueChange, className, idBase, bordered = true, linkAs, ...aria }: TabsProps<V>) {
  const auto = useId()
  const base = idBase ?? `tabs${auto}`
  const listRef = useRef<HTMLDivElement>(null)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"]
    if (!keys.includes(e.key)) return
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]:not([aria-disabled="true"])') ?? [])
    const i = tabs.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
    tabs[next].focus()
    tabs[next].click()
  }

  return (
    <div className={cn("relative", bordered && "border-b border-border-subtle", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={aria["aria-label"]}
        onKeyDown={onKeyDown}
        className="flex items-stretch gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const selected = item.value === value
          const Comp: React.ElementType = item.href ? (linkAs ?? "a") : "button"
          return (
            <Comp
              key={item.value}
              {...(item.href ? { href: item.href } : { type: "button" })}
              role="tab"
              id={`${base}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={item.href ? undefined : `${base}-panel-${item.value}`}
              aria-disabled={item.disabled || undefined}
              tabIndex={selected ? 0 : -1}
              data-state={selected ? "active" : "inactive"}
              onClick={(e: React.MouseEvent) => {
                if (item.disabled) { e.preventDefault(); return }
                onValueChange?.(item.value)
              }}
              className={cn(
                "relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent text-ui font-medium",
                "text-fg-muted transition-[color,border-color] duration-[var(--ds-dur-base)] ease-[var(--ds-ease-standard)] hover:text-fg",
                "aria-[disabled=true]:cursor-not-allowed aria-[disabled=true]:opacity-45",
                selected && "border-primary text-fg",
              )}
            >
              {item.icon != null && <span className="inline-flex [&>svg]:size-4" aria-hidden="true">{item.icon}</span>}
              {item.label}
              {item.count != null && <CountBadge count={item.count} />}
            </Comp>
          )
        })}
      </div>
    </div>
  )
}

export function TabPanel({ idBase, value, className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { idBase: string; value: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${value}`} aria-labelledby={`${idBase}-tab-${value}`} tabIndex={0} className={cn("outline-offset-4", className)} {...props}>
      {children}
    </div>
  )
}
