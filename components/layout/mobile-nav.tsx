"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { Clock, FileBarChart, House } from "lucide-react"
import { NAV_ITEMS } from "@/lib/constants"
import { usePermissions } from "@/lib/permissions-context"
import { useIsManager } from "@/hooks/use-is-manager"
import type { Permission } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { MobileFormsMenu } from "./available-forms-menu"
import { navIcon } from "./nav-icons"
import { SidebarNavItem, sidebarFocus } from "./sidebar-nav-item"
import { HeaderFormsMenu } from "./header-forms-menu"
import { useNavCounts } from "@/hooks/use-nav-counts"
import { formatNavBadge, navBadgeCount, navBadgeLabel } from "@/lib/nav-badges"
import { Sheet, SheetContent } from "@/components/ui/sheet"

/**
 * Mobile navigation (< md only; docs/design/ui-polish-spec.md §5.18):
 *
 * - `MobileNavSheet`: the side menu as a 280px left Sheet, opened from the
 *   top bar's menu button. Runtime destinations only (items flagged
 *   `mobileVisible` in NAV_ITEMS); builders and admin stay on desktop.
 * - `MobileTabBar`: the fixed bottom tab bar, safe-area aware.
 */

interface MobileNavItem {
  label: string
  href: string
  icon: string
  enabled: boolean
  mobileVisible?: boolean
  managerOnly?: boolean
  requiredPermission?: Permission
}

function useMobileNavItems(): readonly MobileNavItem[] {
  const { can } = usePermissions()
  const isManager = useIsManager(can('tasks.view_own'))
  const allItems: readonly MobileNavItem[] = NAV_ITEMS
  return allItems.filter((item) => {
    if (!item.mobileVisible) return false
    if (item.managerOnly && !isManager) return false
    return !item.requiredPermission || can(item.requiredPermission)
  })
}

function isPathActive(pathname: string, href: string) {
  if (pathname === href) return true
  if (!pathname.startsWith(`${href}/`)) return false
  // Don't light up parents when on a sibling sub-route (mirrors sidebar logic).
  if (href === "/tasks" && ["/tasks/assigned", "/tasks/team"].some(s => pathname.startsWith(s))) return false
  return true
}

interface MobileNavSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { display_name: string; tenant: { name: string; branding: { logo_url?: string | null } | null } | null }
  currentTenantId: string | null
}

export function MobileNavSheet({ open, onOpenChange }: MobileNavSheetProps) {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const items = useMobileNavItems()
  const counts = useNavCounts()

  // Close whenever the route changes (link tapped, back button, etc.)
  useEffect(() => {
    onOpenChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        title="Menu"
        className={cn("themed-sidebar w-[280px] max-w-[85vw] border-[color:var(--theme-sidebar-border)] pt-[env(safe-area-inset-top)] md:hidden [&_h2]:text-[color:var(--theme-sidebar-text)]! [&_button[aria-label=Close]]:text-[color:var(--theme-sidebar-muted)]", sidebarFocus)}
      >
        <div className="px-3 pt-2">
          {/* The Forms dropdown, as at the top of the desktop side menu. */}
          <HeaderFormsMenu />
        </div>
        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.href}>
                <SidebarNavItem
                  href={item.href}
                  label={item.label}
                  icon={navIcon(item.icon)}
                  badgeCount={navBadgeCount(counts, item.href)}
                  badgeTone={item.href === "/tasks" ? "accent" : "neutral"}
                />
              </li>
            ))}
          </ul>
          {/* Available forms: the forms this person was given access to. */}
          <div className="mt-2"><MobileFormsMenu /></div>
          <p className="px-2 pt-4 text-xs text-[color:var(--theme-sidebar-muted)]">
            Builders, settings and integrations are available on desktop.
          </p>
        </nav>
      </SheetContent>
    </Sheet>
  )
}

const TAB_ITEMS = [
  { label: "Home", href: "/home", icon: House, requiredPermission: null },
  { label: "Tasks", href: "/tasks", icon: Clock, requiredPermission: "tasks.view_own" },
  { label: "Reports", href: "/reports", icon: FileBarChart, requiredPermission: "reports.view" },
] as const

export function MobileTabBar() {
  const pathname = usePathname()
  const { can } = usePermissions()

  const tabs = TAB_ITEMS.filter((tab) => !tab.requiredPermission || can(tab.requiredPermission))
  const counts = useNavCounts()

  return (
    <nav
      className="themed-topbar fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Tabs"
    >
      <div className="flex items-stretch justify-around">
        {tabs.map((tab) => {
          const active = isPathActive(pathname, tab.href)
          const Icon = tab.icon
          // The Tasks tab is My tasks: its badge is the My tasks count.
          const count = navBadgeCount(counts, tab.href)
          const text = formatNavBadge(count)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn("flex h-[calc(var(--ds-tabbar-h)-1px)] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-2", active ? "text-primary-text" : "text-fg-muted")}
              aria-current={active ? "page" : undefined}
              aria-label={count ? navBadgeLabel(tab.label, count) : undefined}
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                {text && (
                  <span aria-hidden data-nav-badge={text} className="num absolute -right-2.5 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold text-primary-fg">
                    {text}
                  </span>
                )}
              </span>
              <span className="text-2xs font-medium">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
