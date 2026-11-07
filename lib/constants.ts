import type { Permission } from "./permissions"

// `mobileVisible: true` marks runtime destinations that appear in the
// mobile drawer nav (< 768px). Design-time surfaces (workflow builder,
// data, admin) intentionally omit the flag — phones
// get a runtime-only experience.
export const NAV_ITEMS = [
  {
    // The post-login landing page: metrics, favourite forms, my tasks
    // (queued included) / following / submissions. Every signed-in person.
    label: "Home",
    href: "/home",
    icon: "Home" as const,
    enabled: true,
    mobileVisible: true,
  },
  {
    label: "My tasks",
    href: "/tasks",
    icon: "ListChecks" as const,
    enabled: true,
    mobileVisible: true,
    requiredPermission: "tasks.view_own" as const,
  },
  {
    // Shown only to managers (anyone with a direct report): their reports' open tasks.
    label: "My team",
    href: "/tasks/team",
    icon: "UserCheck" as const,
    enabled: true,
    mobileVisible: true,
    managerOnly: true,
    requiredPermission: "tasks.view_own" as const,
  },
  {
    label: "Task tracker",
    href: "/tasks/assigned",
    icon: "Eye" as const,
    enabled: true,
    requiredPermission: "tasks.view_all" as const,
  },
  {
    // Forms, surveys and questionnaires the person built with the form wizard (and drafts).
    label: "My forms",
    href: "/forms/wizard",
    icon: "ClipboardPen" as const,
    enabled: true,
    requiredPermission: "forms.wizard" as const,
  },
  {
    label: "Data",
    href: "/data",
    icon: "Database" as const,
    enabled: true,
    requiredPermission: "data.view" as const,
  },
  {
    label: "Reports",
    href: "/reports",
    icon: "FileBarChart" as const,
    enabled: true,
    mobileVisible: true,
    requiredPermission: "reports.view" as const,
  },
] as const

export const NAV_ITEMS_WORKFLOW = [
  {
    label: "Workflows",
    href: "/automations",
    icon: "Workflow" as const,
    enabled: true,
    requiredPermission: "workflows.view" as const,
  },
  {
    label: "Queue",
    href: "/automations/queue",
    icon: "ListOrdered" as const,
    enabled: true,
    // Involved-only for workflows.view_queue; everything for workflows.view_runs (which implies it).
    requiredPermission: "workflows.view_queue" as const,
  },
  {
    label: "Schedules",
    href: "/automations/schedules",
    icon: "CalendarClock" as const,
    enabled: true,
    requiredPermission: "workflows.view" as const,
  },
  {
    label: "Business rules",
    href: "/automations/rules",
    icon: "Scale" as const,
    enabled: true,
    requiredPermission: "workflows.view" as const,
  },
  {
    label: "Email templates",
    href: "/automations/email-templates",
    icon: "Mail" as const,
    enabled: true,
    requiredPermission: "workflows.view" as const,
  },
  {
    label: "Forms",
    href: "/automations/forms",
    icon: "FileText" as const,
    enabled: true,
    requiredPermission: "forms.view" as const,
  },
  {
    label: "Retention",
    href: "/settings/governance?tab=retention",
    icon: "Archive" as const,
    enabled: true,
    requiredPermission: "team.change_roles" as const,
  },
  {
    label: "Integrations",
    href: "/integrations",
    icon: "Network" as const,
    enabled: true,
    requiredPermission: "integrations.view" as const,
  },
  {
    label: "Extensibility",
    href: "/extensibility",
    icon: "Blocks" as const,
    enabled: true,
    requiredPermission: "extensibility.view" as const,
  },
  {
    label: "Packages",
    href: "/packages",
    icon: "Boxes" as const,
    enabled: true,
    requiredPermission: "packages.view" as const,
  },
  {
    label: "Agents",
    href: "/agents",
    icon: "Bot" as const,
    enabled: true,
    requiredPermission: "agents.view" as const,
  },
] as const

export const NAV_ITEMS_ADMIN = [
  {
    label: "Activity",
    href: "/activity",
    icon: "Activity" as const,
    enabled: true,
    requiredPermission: "settings.view" as const,
  },
  {
    label: "Organization",
    href: "/org",
    icon: "Building2" as const,
    enabled: true,
    requiredPermission: "org.view" as const,
  },
  {
    label: "Team",
    href: "/team",
    icon: "Users" as const,
    enabled: true,
    requiredPermission: "team.view_members" as const,
  },
  {
    label: "MCP access",
    href: "/settings/mcp",
    icon: "Server" as const,
    enabled: true,
    requiredPermission: "settings.view" as const,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "Settings" as const,
    enabled: true,
    requiredPermission: "settings.view" as const,
  },
] as const

/**
 * The side menu (docs/design/ui-polish-spec.md §4.1): primary destinations,
 * then Build / Operate / Govern (collapsible, remembered), with Settings
 * pinned at the bottom. Items come from the lists above by href, so the
 * permissions and the mobile flags stay in one place; every route keeps its URL.
 */
export type NavEntry = (typeof NAV_ITEMS)[number] | (typeof NAV_ITEMS_WORKFLOW)[number] | (typeof NAV_ITEMS_ADMIN)[number]
const ALL_NAV_ITEMS: readonly NavEntry[] = [...NAV_ITEMS, ...NAV_ITEMS_WORKFLOW, ...NAV_ITEMS_ADMIN]
const navItem = (href: string): NavEntry => {
  const item = ALL_NAV_ITEMS.find((i) => i.href === href)
  if (!item) throw new Error(`Unknown nav item ${href}`)
  return item
}

export type NavGroupId = "build" | "operate" | "people" | "govern"

export interface NavGroup {
  id: NavGroupId
  label: string
  items: readonly NavEntry[]
}

export const NAV_PRIMARY: readonly NavEntry[] = ["/home", "/tasks", "/tasks/team", "/tasks/assigned", "/forms/wizard"].map(navItem)

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "build", label: "Build", items: ["/automations", "/automations/forms", "/data", "/integrations", "/agents", "/automations/email-templates"].map(navItem) },
  { id: "operate", label: "Operate", items: ["/automations/queue", "/automations/schedules", "/activity", "/reports"].map(navItem) },
  { id: "govern", label: "Govern", items: ["/automations/rules", "/settings/governance?tab=retention", "/packages", "/extensibility", "/org", "/team", "/settings/mcp"].map(navItem) },
]

/**
 * Read-only placement (governance audit 2026-11): a page that is a design or
 * admin area for people who can change it is just something to read for
 * everyone else. Without any of `authorPerms`, the item moves out of its
 * Build / Govern group into `group` — so a Viewer browsing data sees it under
 * Operate, and the people directory under People, never a Build or Govern
 * heading for areas they cannot change.
 */
export const NAV_READ_ONLY_PLACEMENT: Readonly<Record<string, { group: NavGroupId; authorPerms: readonly Permission[] }>> = {
  "/data": { group: "operate", authorPerms: ["data.create", "data.edit_schema", "data.delete"] },
  "/org": { group: "people", authorPerms: ["org.manage", "projects.manage", "team.change_roles"] },
  "/team": { group: "people", authorPerms: ["team.invite", "team.remove", "team.change_roles"] },
}

const GROUP_LABELS: Record<NavGroupId, string> = { build: "Build", operate: "Operate", people: "People", govern: "Govern" }
const GROUP_ORDER: readonly NavGroupId[] = ["build", "operate", "people", "govern"]

/**
 * The side menu's groups for one person: each group's items they may open
 * (`visible`), read-only items moved per NAV_READ_ONLY_PLACEMENT, empty
 * groups dropped. `has` answers "does this person hold the permission".
 */
export function resolveNavGroups(
  has: (permission: Permission) => boolean,
  visible: (item: NavEntry) => boolean,
): NavGroup[] {
  const buckets = new Map<NavGroupId, NavEntry[]>(GROUP_ORDER.map((id) => [id, []]))
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!visible(item)) continue
      const placement = NAV_READ_ONLY_PLACEMENT[item.href]
      const target = placement && !placement.authorPerms.some(has) ? placement.group : group.id
      buckets.get(target)!.push(item)
    }
  }
  return GROUP_ORDER.flatMap((id) => {
    const items = buckets.get(id)!
    return items.length ? [{ id, label: GROUP_LABELS[id], items }] : []
  })
}

export const NAV_SETTINGS: NavEntry = navItem("/settings")
