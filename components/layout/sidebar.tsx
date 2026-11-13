"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { BookOpen, ChevronDown, PanelLeftClose, PanelLeftOpen, X } from "lucide-react"
import { SidebarNavItem, isNavItemActive, sidebarFocus, sidebarItemClass, sidebarMuted, sidebarText, type NavBadgeTone } from "./sidebar-nav-item"
import { SidebarFormsMenu } from "./available-forms-menu"
import { SidebarDecorations } from "./sidebar-decorations"
import { navIcon } from "./nav-icons"
import { HeaderFormsMenu } from "./header-forms-menu"
import { useWorkspaceBrand } from "@/components/providers/theme-provider"
import { LogoMark } from "@/components/brand/logo"
import { NAV_PRIMARY, NAV_SETTINGS, resolveNavGroups } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/stores/app-store"
import { usePermissions } from "@/lib/permissions-context"
import { hasExtensibilityFeatureAccess } from "@/lib/extensibility-access"
import { useIsManager } from "@/hooks/use-is-manager"
import { useNavCounts, useNavCountsSync } from "@/hooks/use-nav-counts"
import { navBadgeCount } from "@/lib/nav-badges"
import { Tooltip } from "@/components/ui/tooltip"
import { GettingStartedLauncher } from "@/components/onboarding/getting-started/launcher"
import { coreShellItem, mergeByOrder, mergeNavSections, useExtensionBadgeCounts, useExtensionNav, type ShellNavItem } from "@/components/extensions/extension-nav"

/**
 * The side menu (docs/design/ui-polish-spec.md §4.1): the Forms dropdown at
 * the top (the forms shared with you; workspaces are in the avatar menu), the
 * primary destinations, Build / Operate / Govern (collapsible, remembered per
 * browser), Settings pinned at the bottom, then Help & docs and the collapse
 * toggle. 240px wide (the theme's sidebarWidth overrides), 56px collapsed.
 */

interface SidebarProps {
  user: { display_name: string; tenant: { name: string; branding: any } | null }
  currentTenantId: string | null
  userRole: string | null
}

/** Your own open and queued tasks ask for action (accent); the tracker count is neutral. */
const BADGE_TONE: Record<string, NavBadgeTone> = { "/tasks": "accent" }

const GROUPS_KEY = "usertasks.nav.groups"

/** Which groups are folded away (remembered per browser). */
export function useNavGroupState() {
  // Core group ids (build, operate, people, govern) and extension sections (ext:<extension>:<section>).
  const [folded, setFolded] = useState<Partial<Record<string, boolean>>>({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GROUPS_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration (localStorage is client-only)
      if (raw) setFolded(JSON.parse(raw))
    } catch {}
  }, [])
  const toggle = (id: string) => setFolded((current) => {
    const next = { ...current, [id]: !current[id] }
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(next)) } catch {}
    return next
  })
  return { folded, toggle }
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { sidebarCollapsed: collapsed, toggleSidebar, openTasks, removeOpenTask } = useAppStore()
  const { can, permissions } = usePermissions()
  const isManager = useIsManager(can("tasks.view_own"))
  // Pending counts beside My tasks (queued included) / Task tracker (the sidebar is always mounted: it keeps them fresh).
  const navCounts = useNavCounts()
  useNavCountsSync()
  const { folded, toggle } = useNavGroupState()

  const visible = (item: { href: string; requiredPermission?: string; managerOnly?: boolean }) => {
    if (item.href === "/extensibility") return hasExtensibilityFeatureAccess(permissions)
    if (item.managerOnly && !isManager) return false
    return !item.requiredPermission || can(item.requiredPermission as Parameters<typeof can>[0])
  }

  // Extension nav items and sections (none in a build without extensions).
  const extensionNav = useExtensionNav(isManager)
  const primary = mergeByOrder(NAV_PRIMARY.filter(visible).map(coreShellItem), extensionNav.byGroup.primary ?? [])
  const sections = mergeNavSections(resolveNavGroups(can, visible), extensionNav)
  const extensionBadges = useExtensionBadgeCounts([...primary, ...sections.flatMap((s) => s.items)])

  const renderItem = (item: ShellNavItem) => (
    <SidebarNavItem
      key={item.key}
      href={item.href}
      label={item.label}
      icon={typeof item.icon === "string" ? navIcon(item.icon) : item.icon}
      enabled={item.enabled}
      collapsed={collapsed}
      badgeCount={item.badge ? extensionBadges.get(item.key) : navBadgeCount(navCounts, item.href)}
      badgeTone={BADGE_TONE[item.href]}
    />
  )

  return (
    <aside
      className={cn(
        // Desktop-only: on phones the shell renders the mobile Sheet instead.
        "premium-sidebar themed-sidebar flex h-full shrink-0 flex-col border-r border-[color:var(--theme-sidebar-border)] transition-[width] duration-[var(--ds-dur-base)] ease-[var(--ds-ease-standard)] max-md:hidden",
        collapsed ? "w-14" : "w-[var(--theme-sidebar-width)]",
        sidebarFocus,
      )}
      aria-label="Main"
      data-collapsed={collapsed || undefined}
    >
      {!collapsed && <SidebarDecorations />}

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className={cn("flex h-[var(--theme-topbar-height)] shrink-0 items-center gap-1 border-b border-[color:var(--theme-sidebar-border)]", collapsed ? "justify-center px-2" : "px-2")}>
          {/* The workspace logo (Home), then the Forms dropdown: the forms shared with this person (workspaces are in the avatar menu). */}
          <SidebarLogo branding={user.tenant?.branding ?? null} name={user.tenant?.name ?? "UserTasks"} collapsed={collapsed} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <HeaderFormsMenu collapsed={false} />
            </div>
          )}
        </div>
        {collapsed && (
          <div className="shrink-0 px-2 pt-2">
            <HeaderFormsMenu collapsed />
          </div>
        )}

        <nav aria-label="Primary" className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin py-3", collapsed ? "px-2" : "px-3")}>
          <ul className="space-y-0.5">
            {primary.map((item) => (
              <li key={item.key}>
                {renderItem(item)}
                {item.href === "/tasks" && !collapsed && openTasks.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5 pl-6" aria-label="Open tasks">
                    {openTasks.map((task) => {
                      const active = pathname === `/tasks/${task.id}`
                      return (
                        <li key={task.id} className={cn("group/pin flex h-7 items-center gap-1 rounded-md pr-1 hover:bg-[var(--sidebar-hover-bg)]", active && "bg-[var(--theme-sidebar-active)]")}>
                          <Link
                            href={`/tasks/${task.id}`}
                            aria-current={active ? "page" : undefined}
                            className={cn("min-w-0 flex-1 truncate rounded-md px-2 text-xs font-medium", active ? "text-[color:var(--theme-sidebar-accent,var(--theme-primary))]" : sidebarMuted)}
                          >
                            {task.title}
                          </Link>
                          <button
                            type="button"
                            onClick={() => removeOpenTask(task.id)}
                            className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-[var(--sidebar-hover-bg)] focus-visible:opacity-100 group-hover/pin:opacity-100 pointer-coarse:opacity-100", sidebarMuted)}
                            aria-label={`Close ${task.title}`}
                          >
                            <X className="size-3" aria-hidden />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            ))}
            {/* People without the Forms library still get their available forms. */}
            {!can("forms.view") && <li><SidebarFormsMenu collapsed={collapsed} /></li>}
          </ul>

          {sections.map((group) => {
            const items = group.items
            const isFolded = !collapsed && !!folded[group.id]
            // A folded group still shows the page you're on.
            const shown = isFolded ? items.filter((item) => isNavItemActive(item.href, pathname, searchParams)) : items
            const listId = `nav-group-${group.id.replace(/[^a-z0-9-]/gi, '-')}`
            return (
              <section key={group.id} aria-labelledby={collapsed ? undefined : `${listId}-label`} className={collapsed ? "mt-3 border-t border-[color:var(--theme-sidebar-border)] pt-3" : "mt-6"}>
                {!collapsed && (
                  <button
                    type="button"
                    id={`${listId}-label`}
                    onClick={() => toggle(group.id)}
                    aria-expanded={!isFolded}
                    aria-controls={listId}
                    className={cn("mb-1 flex h-6 w-full items-center gap-1 rounded-md px-2 text-2xs font-medium hover:text-[color:var(--theme-sidebar-text)]", sidebarMuted)}
                    data-nav-group={group.id}
                  >
                    <span className="flex-1 text-left">{group.label}</span>
                    <ChevronDown className={cn("size-3 transition-transform duration-[var(--ds-dur-fast)]", isFolded && "-rotate-90")} aria-hidden />
                  </button>
                )}
                <ul id={listId} className="space-y-0.5">
                  {shown.map((item) => <li key={item.key}>{renderItem(item)}</li>)}
                </ul>
              </section>
            )
          })}
        </nav>

        <div className={cn("shrink-0 border-t border-[color:var(--theme-sidebar-border)] py-2", collapsed ? "px-2" : "px-3")}>
          <GettingStartedLauncher collapsed={collapsed} />
          {visible(NAV_SETTINGS) && renderItem(coreShellItem(NAV_SETTINGS))}
          <div className={cn("mt-0.5 flex gap-0.5", collapsed ? "flex-col" : "items-center")}>
            <Tooltip content="Help & docs" side="right" enabled={collapsed}>
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(sidebarItemClass, collapsed ? "justify-center px-0" : "flex-1")}
                aria-label={collapsed ? "Help & docs (opens in a new tab)" : undefined}
              >
                <BookOpen className={cn("size-4 shrink-0", sidebarMuted)} aria-hidden />
                {!collapsed && <span className="truncate">Help &amp; docs</span>}
              </a>
            </Tooltip>
            <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!collapsed}
                className={cn(sidebarItemClass, "w-auto justify-center px-0", collapsed ? "w-full" : "w-8")}
                data-sidebar-toggle
              >
                {collapsed ? <PanelLeftOpen className={cn("size-4", sidebarMuted)} aria-hidden /> : <PanelLeftClose className={cn("size-4", sidebarMuted)} aria-hidden />}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </aside>
  )
}

/** The workspace logo (or the UserTasks mark) at the top of the side menu; links Home. */
function SidebarLogo({ branding, name, collapsed }: { branding: { logo_url?: string | null } | null; name: string; collapsed: boolean }) {
  const { logoUrl } = useWorkspaceBrand(branding?.logo_url ?? null)
  return (
    <Tooltip content={name} side="right" enabled={collapsed}>
      <Link href="/home" aria-label={`${name} — Home`} data-sidebar-logo
        className={cn("flex h-10 shrink-0 items-center justify-center rounded-md px-1.5 hover:bg-[var(--sidebar-hover-bg)]", sidebarFocus)}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className={cn("object-contain", collapsed ? "size-6" : "max-h-6 max-w-[88px]")} />
        ) : (
          <LogoMark variant="glyph" size={22} color="var(--theme-sidebar-text)" accent="var(--theme-sidebar-accent, var(--theme-primary))" />
        )}
      </Link>
    </Tooltip>
  )
}
