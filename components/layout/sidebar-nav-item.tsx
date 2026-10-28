"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import * as Tooltip from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface SidebarNavItemProps {
  href: string
  label: string
  icon: LucideIcon
  enabled?: boolean
  tooltip?: string
  collapsed?: boolean
  /**
   * Optional unread/pending count rendered as a pill beside the label
   * (or as a tiny dot when the sidebar is collapsed). Falsy values
   * render nothing. Numbers > 99 display as "99+".
   */
  badgeCount?: number
}

export function SidebarNavItem({
  href,
  label,
  icon: Icon,
  enabled = true,
  tooltip,
  collapsed = false,
  badgeCount,
}: SidebarNavItemProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSearch = searchParams.toString()

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
    !(targetPathname === "/tasks" && ["/tasks/queue", "/tasks/assigned", "/tasks/team"].some(s => pathname.startsWith(s))) &&
    !(targetPathname === "/automations" && ["/automations/queue", "/automations/rules", "/automations/schedules", "/automations/email-templates", "/automations/forms"].some(s => pathname.startsWith(s))) &&
    !(targetPathname === "/settings" && ["/settings/mcp"].some(s => pathname.startsWith(s))) &&
    !(targetPathname === "/settings" && pathname === "/settings/governance" && searchParams.get("tab") === "retention")
  )

  const isActive = isQueryScopedRoute
    ? pathname === targetPathname && hasQueryMatch
    : isParentRouteActive

  const showBadge = typeof badgeCount === 'number' && badgeCount > 0
  const badgeLabel = showBadge ? (badgeCount! > 99 ? '99+' : String(badgeCount)) : ''

  const content = (
    <span
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
        isActive
          ? "themed-sidebar-active"
          : "hover:bg-[var(--sidebar-hover-bg)] hover:backdrop-blur-sm",
        !enabled && "pointer-events-none opacity-50"
      )}
    >
      <span className="relative shrink-0">
        <Icon className="h-4 w-4" />
        {/* When collapsed, the label pill is hidden — show a small dot
            in the top-right of the icon so the user still sees unread
            state at a glance. */}
        {showBadge && collapsed && (
          <span
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2"
            style={{
              backgroundColor: 'var(--theme-danger)',
              // @ts-expect-error — CSS ring-color via var
              '--tw-ring-color': 'var(--theme-sidebar)',
            }}
          />
        )}
      </span>
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full" style={{ backgroundColor: 'var(--theme-sidebar-accent, var(--theme-primary))' }} />
      )}
      {!collapsed && <span>{label}</span>}
      {!collapsed && showBadge && (
        <span
          className="ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-bold min-w-[18px] h-[18px] px-1.5"
          style={{
            backgroundColor: 'var(--theme-danger)',
            color: 'var(--theme-on-danger)',
          }}
        >
          {badgeLabel}
        </span>
      )}
    </span>
  )

  if (!enabled && tooltip) {
    return (
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div>{content}</div>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="right"
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white dark:bg-gray-100 dark:text-gray-900"
              sideOffset={8}
            >
              {tooltip}
              <Tooltip.Arrow className="fill-gray-900 dark:fill-gray-100" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    )
  }

  if (!enabled) return content

  return <Link href={href} prefetch={true}>{content}</Link>
}
