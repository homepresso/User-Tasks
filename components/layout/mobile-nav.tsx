"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutGrid,
  Clock,
  Inbox,
  Users,
  UserCheck,
  Blocks,
  FileText,
  FileBarChart,
  X,
  type LucideIcon, Briefcase, MonitorSmartphone } from 'lucide-react'
import { NAV_ITEMS } from "@/lib/constants"
import { usePermissions } from "@/lib/permissions-context"
import { useIsManager } from "@/hooks/use-is-manager"
import type { Permission } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { useWorkspaceBrand } from "@/components/providers/theme-provider"
import { LogoMark } from "@/components/brand/logo"

/**
 * Mobile navigation (< md only). Two pieces:
 *
 * - `MobileNavDrawer` — slide-in overlay drawer opened from the topbar
 *   hamburger. Shows RUNTIME destinations only (items flagged
 *   `mobileVisible` in NAV_ITEMS); design-time groups (Automations,
 *   Admin) are never rendered on phones.
 * - `MobileTabBar` — fixed bottom tab bar with the four core
 *   destinations, safe-area aware.
 *
 * Both render `md:hidden`, so desktop is untouched.
 */

const iconMap: Record<string, LucideIcon> = {
  Briefcase,
  MonitorSmartphone,
  LayoutGrid,
  Clock,
  Inbox,
  Users,
  UserCheck,
  Blocks,
  FileText,
  FileBarChart,
}

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
  if (href === "/tasks" && ["/tasks/queue", "/tasks/assigned", "/tasks/team"].some(s => pathname.startsWith(s))) return false
  return true
}

interface MobileNavDrawerProps {
  open: boolean
  onClose: () => void
  branding?: { logo_url?: string | null } | null
}

export function MobileNavDrawer({ open, onClose, branding }: MobileNavDrawerProps) {
  const pathname = usePathname()
  const items = useMobileNavItems()
  const { logoUrl, wordmark } = useWorkspaceBrand(branding?.logo_url ?? null)

  // Close whenever the route changes (link tapped, back button, etc.)
  useEffect(() => {
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        style={{ animation: "mobile-drawer-fade 0.2s ease-out" }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="premium-sidebar themed-sidebar absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r shadow-2xl"
        style={{ borderColor: "var(--theme-sidebar-border)", animation: "mobile-drawer-slide 0.2s ease-out" }}
      >
        <div className="relative z-10 flex h-full flex-col">
          <div
            className="flex h-14 items-center justify-between border-b px-4"
            style={{ borderColor: "var(--theme-sidebar-border)", paddingTop: "env(safe-area-inset-top)" }}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="max-h-8 max-w-[140px] object-contain" />
            ) : (
              <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--sidebar-brand-color)" }}>
                {wordmark ? <span>{wordmark}</span> : (
                  <span className="inline-flex items-center gap-2">
                    <LogoMark variant="glyph" size={24} color="var(--sidebar-brand-color)" accent="var(--theme-sidebar-accent, var(--theme-primary))" />
                    <span>user<span className="themed-sidebar-accent">tasks</span></span>
                  </span>
                )}
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-2 transition-colors hover:bg-[var(--sidebar-hover-bg)]"
              style={{ color: "var(--theme-sidebar-text)" }}
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {items.map((item) => {
              const Icon = iconMap[item.icon] ?? LayoutGrid
              const active = isPathActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "themed-sidebar-active" : "hover:bg-[var(--sidebar-hover-bg)]",
                  )}
                  style={{ color: active ? "var(--theme-sidebar-accent, var(--theme-primary))" : "var(--theme-sidebar-text)" }}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-90" />
                  <span className="truncate">{item.label}</span>
                </Link>
              )
            })}
            <p className="px-3 pt-4 text-[11px] leading-relaxed" style={{ color: "var(--theme-sidebar-muted)" }}>
              Builders, settings, and integrations are available on desktop.
            </p>
          </nav>
        </div>
      </div>

      <style>{`
        @keyframes mobile-drawer-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mobile-drawer-slide { from { transform: translateX(-100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  )
}

const TAB_ITEMS = [
  { label: "Tasks", href: "/tasks", icon: Clock, requiredPermission: "tasks.view_own" },
  { label: "Reports", href: "/reports", icon: FileBarChart, requiredPermission: "reports.view" },
] as const

export function MobileTabBar() {
  const pathname = usePathname()
  const { can } = usePermissions()

  const tabs = TAB_ITEMS.filter((tab) => !tab.requiredPermission || can(tab.requiredPermission))

  return (
    <nav
      className="themed-topbar fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ borderColor: "var(--theme-surface-border)" }}
      aria-label="Primary"
    >
      <div className="flex items-stretch justify-around">
        {tabs.map((tab) => {
          const active = isPathActive(pathname, tab.href)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 pb-1.5 pt-2"
              style={{ color: active ? "var(--theme-primary-text)" : "var(--theme-muted-text)" }}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
