"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { formatNavBadge, navBadgeLabel } from "@/lib/nav-badges"
import { navTourId } from "@/lib/onboarding/tours"

/** `neutral` for plain counts; `accent` where the count asks for action (your own open tasks). */
export type NavBadgeTone = "neutral" | "accent"

interface SidebarNavItemProps {
  href: string
  label: string
  icon: LucideIcon
  enabled?: boolean
  tooltip?: string
  collapsed?: boolean
  /**
   * Optional pending count beside the label (a 6px dot when the sidebar is
   * collapsed). Falsy values render nothing. Numbers > 99 display as "99+".
   */
  badgeCount?: number
  badgeTone?: NavBadgeTone
}

/** Whether a nav href is the current page. Query-scoped hrefs match their query; parents don't light up on sibling sections. */
export function isNavItemActive(href: string, pathname: string, searchParams: URLSearchParams): boolean {
  const target = href.startsWith("/") ? new URL(href, "http://localhost") : null
  const targetPathname = target?.pathname ?? href
  const targetSearch = target?.searchParams ?? null
  const hasQueryMatch = !!targetSearch && Array.from(targetSearch.entries()).every(
    ([key, value]) => searchParams.get(key) === value,
  )

  const isQueryScopedRoute = !!targetSearch && Array.from(targetSearch.keys()).length > 0
  const isParentRouteActive = pathname === targetPathname || (
    pathname.startsWith(targetPathname + "/") &&
    // Don't match parent routes when on a sibling sub-route
    !(targetPathname === "/tasks" && ["/tasks/assigned", "/tasks/team"].some(s => pathname.startsWith(s))) &&
    !(targetPathname === "/automations" && ["/automations/queue", "/automations/rules", "/automations/schedules", "/automations/email-templates", "/automations/forms"].some(s => pathname.startsWith(s))) &&
    !(targetPathname === "/settings" && ["/settings/mcp"].some(s => pathname.startsWith(s))) &&
    !(targetPathname === "/settings" && pathname === "/settings/governance" && searchParams.get("tab") === "retention")
  )

  return isQueryScopedRoute ? pathname === targetPathname && hasQueryMatch : isParentRouteActive
}

/** Focus rings drawn in the sidebar's text colour: the app's ring colour can vanish on a dark sidebar. */
export const sidebarFocus = "[&_:focus-visible]:outline-[color:var(--theme-sidebar-text)]"

/** Sidebar text colours: the sidebar has its own palette (--theme-sidebar-*). */
export const sidebarText = "text-[color:var(--theme-sidebar-text)]"
export const sidebarMuted = "text-[color:var(--theme-sidebar-muted)]"
export const sidebarItemClass = cn(
  "group/nav relative flex h-[max(var(--ds-nav-item-h),var(--ds-touch-min))] w-full items-center gap-2 rounded-md px-2 text-ui font-medium",
  "transition-colors duration-[var(--ds-dur-fast)] hover:bg-[var(--sidebar-hover-bg)]",
  sidebarText,
)

export function NavCount({ count, tone = "neutral", collapsed = false }: { count?: number; tone?: NavBadgeTone; collapsed?: boolean }) {
  const text = formatNavBadge(count)
  if (!text) return null
  if (collapsed) {
    return (
      <span
        aria-hidden
        data-nav-badge-dot
        data-tone={tone}
        className={cn(
          "absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-2 ring-[color:var(--theme-sidebar)]",
          tone === "accent" ? "bg-[color:var(--theme-sidebar-accent,var(--theme-primary))]" : "bg-[color:var(--theme-sidebar-muted)]",
        )}
      />
    )
  }
  return (
    <span
      aria-hidden
      data-nav-badge={text}
      data-tone={tone}
      className={cn(
        "num ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-2xs font-semibold",
        sidebarText,
        tone === "accent"
          ? "bg-[color-mix(in_srgb,var(--theme-sidebar-accent,var(--theme-primary))_24%,transparent)]"
          : "bg-[color-mix(in_srgb,var(--theme-sidebar-text)_12%,transparent)]",
      )}
    >
      {text}
    </span>
  )
}

export function SidebarNavItem({
  href,
  label,
  icon: Icon,
  enabled = true,
  tooltip,
  collapsed = false,
  badgeCount,
  badgeTone = "neutral",
}: SidebarNavItemProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isActive = isNavItemActive(href, pathname, searchParams)
  const showBadge = formatNavBadge(badgeCount) !== null
  const accessibleName = navBadgeLabel(label, badgeCount)

  const content = (
    <>
      {isActive && (
        <span aria-hidden className="absolute -left-2 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[color:var(--theme-sidebar-accent,var(--theme-primary))]" />
      )}
      <span className="relative inline-flex shrink-0">
        <Icon className={cn("size-4", isActive ? "text-[color:var(--theme-sidebar-accent,var(--theme-primary))]" : sidebarMuted)} aria-hidden />
        {collapsed && <NavCount count={badgeCount} tone={badgeTone} collapsed />}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && <NavCount count={badgeCount} tone={badgeTone} />}
    </>
  )

  const className = cn(
    sidebarItemClass,
    collapsed && "justify-center px-0",
    isActive && "bg-[var(--theme-sidebar-active)] text-[color:var(--theme-sidebar-accent,var(--theme-primary))] hover:bg-[var(--theme-sidebar-active)]",
    !enabled && "pointer-events-none opacity-50",
  )

  if (!enabled) {
    const disabled = <span className={className} aria-disabled="true">{content}</span>
    return tooltip ? <Tooltip content={tooltip} side="right"><span className="block">{disabled}</span></Tooltip> : disabled
  }

  const link = (
    <Link
      href={href}
      prefetch={true}
      className={className}
      aria-current={isActive ? "page" : undefined}
      aria-label={showBadge || collapsed ? accessibleName : undefined}
      data-nav-href={href}
      data-tour={navTourId(href)}
    >
      {content}
    </Link>
  )
  return collapsed ? <Tooltip content={accessibleName} side="right">{link}</Tooltip> : link
}
