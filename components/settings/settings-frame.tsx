"use client"

import { useEffect, useState, type ComponentType } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Accessibility,
  CircleCheckBig,
  Boxes,
  Brush,
  Building2,
  Globe,
  GitBranch,
  Key,
  KeyRound,
  Network,
  Package,
  Palette,
  Plug,
  Radio,
  ScanText,
  ScrollText,
  Server,
  Shield,
  SlidersHorizontal,
  Sparkles,
  User,
  UserPlus,
  UsersRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Select } from "@/components/ui/select"
import { usePermissions } from "@/lib/permissions-context"
import type { Permission } from "@/lib/permissions"
import { canViewInfrastructureAction } from "@/app/actions/infrastructure"
import { settingsTourId } from "@/lib/onboarding/tours"

/**
 * The Settings frame (§5.14): a 200px grouped sub-nav beside the page, which
 * fills the canvas. Narrow pages (forms) cap their content at 720px; pages
 * that are tables or editors use the full width. The theme designer is an
 * editor with its own live preview, so it takes the whole canvas and links
 * back with a breadcrumb instead.
 */

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>

export interface SettingsNavItem {
  label: string
  href: string
  icon: Icon
  /** Visible with this permission. */
  permission?: Permission
  /** Shown to every member (the page itself is read-only without edit rights). */
  everyone?: boolean
  /** Instance admins only (INSTANCE_ADMIN_EMAILS), whatever their workspace role. */
  instanceAdmin?: boolean
}

export interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/settings", icon: User, everyone: true },
      { label: "Preferences", href: "/settings?tab=preferences", icon: SlidersHorizontal, everyone: true },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "General", href: "/settings?tab=general", icon: Palette, permission: "settings.view" },
      { label: "Theme", href: "/settings/theme", icon: Brush, permission: "settings.view" },
      { label: "Forms", href: "/settings?tab=forms", icon: Accessibility, permission: "settings.view" },
      { label: "Task completion", href: "/settings?tab=task-completion", icon: CircleCheckBig, permission: "settings.view" },
      { label: "Organizations", href: "/settings?tab=organizations", icon: Building2, everyone: true },
      { label: "Members & invites", href: "/settings/invitations", icon: UserPlus, permission: "team.invite" },
      // The editor lives with the Organization page (import / export, org units, people attributes).
      { label: "Organization structure", href: "/org/manage", icon: Network, permission: "org.manage" },
    ],
  },
  {
    label: "Security",
    items: [
      { label: "Governance", href: "/settings/governance", icon: Shield, permission: "team.change_roles" },
      { label: "SSO & directory", href: "/settings/sso", icon: KeyRound, permission: "settings.view" },
      { label: "API keys", href: "/settings/api-keys", icon: Key, permission: "settings.manage_api_keys" },
      { label: "OAuth apps", href: "/settings/oauth-apps", icon: Boxes, permission: "settings.manage_api_keys" },
    ],
  },
  {
    label: "Developers",
    items: [
      { label: "Webhooks", href: "/settings/webhooks", icon: Globe, permission: "settings.manage_webhooks" },
      { label: "MCP", href: "/settings/mcp", icon: Plug, permission: "settings.view" },
      { label: "GitHub sync", href: "/settings/github-sync", icon: GitBranch, permission: "sync.view" },
      { label: "Log export", href: "/settings/log-export", icon: Radio, permission: "observability.view" },
      { label: "Live logs", href: "/settings/logs", icon: ScrollText, permission: "settings.view" },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { label: "Agent", href: "/settings/assistants", icon: Sparkles, permission: "assistants.manage" },
      { label: "Document OCR", href: "/settings/document-ocr", icon: ScanText, permission: "settings.view" },
      { label: "Infrastructure", href: "/settings/infrastructure", icon: Server, instanceAdmin: true },
      { label: "Workspace DNS", href: "/settings/workspace-dns", icon: Globe, instanceAdmin: true },
      { label: "Packages", href: "/settings/packages", icon: Package, permission: "packages.view" },
      { label: "Gallery review", href: "/settings/gallery-review", icon: UsersRound, instanceAdmin: true },
    ],
  },
]

/** The in-page tabs of /settings and their aliases (old links use ?tab=appearance). */
export const SETTINGS_TABS = ["profile", "preferences", "general", "forms", "task-completion", "organizations"] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
export function settingsTabFrom(raw: string | null): SettingsTab {
  if (raw === "appearance") return "general"
  return (SETTINGS_TABS as readonly string[]).includes(raw ?? "") ? (raw as SettingsTab) : "profile"
}

/** Pages whose content is a form get the 720px reading width; the rest fill the column. */
const NARROW = new Set(["/settings", "/settings/document-ocr", "/settings/assistants", "/settings/invitations", "/settings/webhooks", "/settings/sso"])
/** Editors that take the whole canvas, without the sub-nav. */
const FULL_BLEED = new Set(["/settings/theme"])

function isActive(item: SettingsNavItem, pathname: string, tab: SettingsTab): boolean {
  const [path, query] = item.href.split("?")
  if (path !== pathname) return path !== "/settings" && pathname.startsWith(`${path}/`)
  if (path !== "/settings") return true
  const itemTab = query ? settingsTabFrom(new URLSearchParams(query).get("tab")) : "profile"
  return itemTab === tab
}

function useVisibleGroups(): SettingsNavGroup[] {
  const { can } = usePermissions()
  const [instanceAdmin, setInstanceAdmin] = useState(false)
  useEffect(() => {
    let live = true
    canViewInfrastructureAction().then((ok) => { if (live) setInstanceAdmin(ok) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  return SETTINGS_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.instanceAdmin) return instanceAdmin
      if (item.everyone) return true
      return Boolean(item.permission && can(item.permission))
    }),
  })).filter((group) => group.items.length > 0)
}

export function SettingsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/settings"
  const params = useSearchParams()
  const router = useRouter()
  const tab = settingsTabFrom(params.get("tab"))
  const groups = useVisibleGroups()

  if (FULL_BLEED.has(pathname)) return <>{children}</>

  const narrow = NARROW.has(pathname)
  const all = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))
  const current = all.find((i) => isActive(i, pathname, tab))

  return (
    <div className="flex gap-8 max-md:flex-col max-md:gap-4">
      {/* Mobile: one Select for the whole tree. */}
      <div className="md:hidden">
        <Select
          aria-label="Settings section"
          value={current?.href ?? ""}
          onChange={(e) => router.push(e.target.value)}
        >
          {current == null && <option value="">Settings</option>}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => <option key={i.href} value={i.href}>{i.label}</option>)}
            </optgroup>
          ))}
        </Select>
      </div>

      <nav aria-label="Settings" className="w-[200px] shrink-0 self-start max-md:hidden md:sticky md:top-0">
        <p className="mb-3 px-2 text-base font-semibold text-fg">Settings</p>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1 px-2 text-xs font-medium text-fg-muted">{g.label}</p>
              <ul className="space-y-px">
                {g.items.map((item) => {
                  const active = isActive(item, pathname, tab)
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        data-tour={settingsTourId(item.href)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-[var(--ds-nav-item-h)] items-center gap-2 rounded-md px-2 text-ui",
                          "transition-colors duration-[var(--ds-dur-fast)] ease-[var(--ds-ease-standard)]",
                          active ? "bg-muted font-medium text-fg" : "text-fg-muted hover:bg-subtle hover:text-fg",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className={cn("min-w-0 flex-1", narrow && "max-w-[720px]")}>{children}</div>
    </div>
  )
}
