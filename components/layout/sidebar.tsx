"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutGrid,
  Clock,
  Inbox,
  Eye,
  List,
  BarChart3,
  Database,
  Network,
  TrendingUp,
  Globe,
  Users,
  UserCheck,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ListOrdered,
  Scale,
  Bot,
  FileBarChart,
  FileText,
  Activity,
  X,
  Blocks,
  Mail,
  Boxes,
  Briefcase, MonitorSmartphone } from 'lucide-react'
import { SidebarNavItem } from "./sidebar-nav-item"
import { OrgSwitcher } from "./org-switcher"
import { NAV_ITEMS, NAV_ITEMS_WORKFLOW, NAV_ITEMS_ADMIN } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/stores/app-store"
import { useWorkspaceBrand } from "@/components/providers/theme-provider"
import { LogoMark } from "@/components/brand/logo"
import { usePermissions } from "@/lib/permissions-context"
import { hasExtensibilityFeatureAccess } from "@/lib/extensibility-access"
import { useIsManager } from "@/hooks/use-is-manager"

const iconMap = {
  LayoutGrid,
  Briefcase,
  MonitorSmartphone,
  Clock,
  Inbox,
  Eye,
  List,
  BarChart3,
  Database,
  Network,
  TrendingUp,
  Globe,
  Users,
  UserCheck,
  Settings,
  ListOrdered,
  Scale,
  Bot,
  FileBarChart,
  FileText,
  Activity,
  Blocks,
  Boxes,
  Mail,
} as const

interface SidebarProps {
  user: { display_name: string; tenant: { name: string; branding: any } | null }
  currentTenantId: string | null
  userRole: string | null
}

export function Sidebar({ user, currentTenantId, userRole: _userRole }: SidebarProps) {
  const pathname = usePathname()
  const {
    sidebarCollapsed: collapsed,
    toggleSidebar,
    openTasks,
    removeOpenTask,
  } = useAppStore()
  const { can, permissions } = usePermissions()
  const isManager = useIsManager(can('tasks.view_own'))
  const { logoUrl, wordmark } = useWorkspaceBrand(user.tenant?.branding?.logo_url ?? null)

  const filterByPermission = (items: readonly any[]) =>
    items.filter(item => {
      if (item.href === '/extensibility') return hasExtensibilityFeatureAccess(permissions)
      if (item.managerOnly && !isManager) return false
      return !item.requiredPermission || can(item.requiredPermission)
    })

  return (
    <aside
      className={cn(
        // Desktop-only: on phones the shell renders MobileNavDrawer instead.
        "premium-sidebar themed-sidebar flex h-full flex-col border-r transition-all max-md:hidden",
        collapsed ? "w-16" : "w-[var(--theme-sidebar-width)]"
      )}
      style={{ borderColor: 'var(--theme-sidebar-border)' }}
    >
      {/* Decorative layer — glows + floating illustrations. Hidden when collapsed or non-default theme */}
      {!collapsed && (
        <div className="sidebar-decorations pointer-events-none absolute inset-0 z-0">
          {/* Teal glow — top-left */}
          <div
            className="absolute rounded-full"
            style={{
              top: '20%',
              left: '-80px',
              width: '360px',
              height: '360px',
              background: 'radial-gradient(circle, var(--sidebar-glow-1) 0%, transparent 70%)',
              animation: 'glowPulse 6s ease-in-out infinite',
            }}
          />
          {/* Indigo glow — bottom-right */}
          <div
            className="absolute rounded-full"
            style={{
              bottom: '15%',
              right: '-40px',
              width: '300px',
              height: '300px',
              background: 'radial-gradient(circle, var(--sidebar-glow-2) 0%, transparent 70%)',
              animation: 'glowPulse 8s ease-in-out 3s infinite',
            }}
          />
          {/* Agent orbit — top-right, behind nav */}
          <div
            className="deco-orbit absolute"
            style={{
              top: '220px',
              right: '12px',
              opacity: 0.04,
              animation: 'floatY 10s ease-in-out 2s infinite',
            }}
          >
            <svg width="80" height="80" viewBox="0 0 120 120" fill="none">
              <circle cx="60" cy="60" r="50" stroke="white" strokeWidth="2" />
              <circle cx="60" cy="60" r="30" stroke="white" strokeWidth="1.5" strokeDasharray="6 4" />
              <circle cx="60" cy="60" r="8" fill="white" />
              <circle cx="60" cy="10" r="4" fill="white" style={{ transformOrigin: '60px 60px', animation: 'orbit 6s linear infinite' }} />
              <circle cx="110" cy="60" r="3" fill="white" style={{ transformOrigin: '60px 60px', animation: 'orbit 8s linear 1s infinite' }} />
            </svg>
          </div>
          {/* Workflow nodes — bottom area */}
          <div
            className="deco-workflow absolute"
            style={{
              bottom: '48px',
              left: '12px',
              opacity: 0.05,
              animation: 'floatY 8s ease-in-out infinite',
            }}
          >
            <svg width="220" height="160" viewBox="0 0 280 200" fill="none">
              <rect x="110" y="10" width="60" height="32" rx="8" fill="white" />
              <rect x="30" y="80" width="60" height="32" rx="8" fill="white" />
              <rect x="190" y="80" width="60" height="32" rx="8" fill="white" />
              <rect x="70" y="155" width="60" height="32" rx="8" fill="white" />
              <rect x="150" y="155" width="60" height="32" rx="8" fill="white" />
              <path d="M130 42 L60 80" stroke="white" strokeWidth="2" />
              <path d="M150 42 L220 80" stroke="white" strokeWidth="2" />
              <path d="M60 112 L100 155" stroke="white" strokeWidth="2" />
              <path d="M220 112 L180 155" stroke="white" strokeWidth="2" />
            </svg>
          </div>
        </div>
      )}

      {/* Content layer */}
      <div className="relative z-10 flex flex-col h-full">
      <div className="flex h-[var(--theme-topbar-height)] items-center justify-between border-b px-4" style={{ borderColor: 'var(--theme-sidebar-border)' }}>
        {!collapsed && (
          logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo"
              className="max-h-8 max-w-[140px] object-contain"
            />
          ) : (
            <span className="text-lg font-semibold tracking-tight" style={{ color: 'var(--sidebar-brand-color)' }}>
              {wordmark ? <span>{wordmark}</span> : (
                <span className="inline-flex items-center gap-2">
                  <LogoMark variant="glyph" size={24} color="var(--sidebar-brand-color)" accent="var(--theme-sidebar-accent, var(--theme-primary))" />
                  <span>user<span className="themed-sidebar-accent">tasks</span></span>
                </span>
              )}
            </span>
          )
        )}
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1 transition-colors hover:bg-[var(--sidebar-hover-bg)]"
          style={{ color: 'var(--theme-sidebar-text)' }}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-2 border-b px-3 py-2" style={{ borderColor: 'var(--theme-sidebar-border)' }}>
          <div className="rounded-lg border" style={{ borderColor: 'var(--theme-sidebar-border)' }}>
            <OrgSwitcher currentTenantId={currentTenantId} />
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        <div className="space-y-1">
          {filterByPermission(NAV_ITEMS).map((item: any) => (
            <div key={item.href}>
              <SidebarNavItem
                href={item.href}
                label={item.label}
                icon={iconMap[item.icon as keyof typeof iconMap]}
                enabled={item.enabled}
                tooltip={item.tooltip}
                collapsed={collapsed}
              />
              {item.href === '/tasks' && !collapsed && openTasks.length > 0 && (
                <div className="mt-1 ml-7 space-y-1">
                  {openTasks.map((task) => {
                    const isActiveTask = pathname === `/tasks/${task.id}`
                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-1 rounded-md pr-1"
                        style={{
                          backgroundColor: isActiveTask ? 'var(--theme-sidebar-active)' : 'transparent',
                        }}
                      >
                        <Link
                          href={`/tasks/${task.id}`}
                          className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-[var(--sidebar-hover-bg)]"
                          style={{
                            color: isActiveTask ? 'var(--theme-sidebar-accent)' : 'var(--theme-sidebar-muted)',
                            fontWeight: isActiveTask ? 600 : 500,
                          }}
                          title={task.title}
                        >
                          {task.title}
                        </Link>
                        <button
                          type="button"
                          onClick={() => removeOpenTask(task.id)}
                          className="rounded p-1 transition-colors hover:bg-[var(--sidebar-hover-bg)]"
                          style={{ color: 'var(--theme-sidebar-muted)' }}
                          aria-label={`Close ${task.title}`}
                          title="Close task"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {filterByPermission(NAV_ITEMS_WORKFLOW).length > 0 && (
          <>
            <div className="my-4 border-t" style={{ borderColor: 'var(--theme-sidebar-border)' }} />
            {!collapsed && (
              <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--theme-sidebar-muted)' }}>
                Automations
              </p>
            )}
            <div className="space-y-1">
              {filterByPermission(NAV_ITEMS_WORKFLOW).map((item: any) => (
                <SidebarNavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={iconMap[item.icon as keyof typeof iconMap]}
                  enabled={item.enabled}
                  tooltip={item.tooltip}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </>
        )}

        {filterByPermission(NAV_ITEMS_ADMIN).length > 0 && (
          <>
            <div className="my-4 border-t" style={{ borderColor: 'var(--theme-sidebar-border)' }} />
            {!collapsed && (
              <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--theme-sidebar-muted)' }}>
                Admin
              </p>
            )}
            <div className="space-y-1">
              {filterByPermission(NAV_ITEMS_ADMIN).map((item: any) => (
                <SidebarNavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={iconMap[item.icon as keyof typeof iconMap]}
                  enabled={item.enabled}
                  tooltip={item.tooltip}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </>
        )}
      </nav>
      </div>

    </aside>
  )
}

