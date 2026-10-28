// `mobileVisible: true` marks runtime destinations that appear in the
// mobile drawer nav (< 768px). Design-time surfaces (workflow builder,
// data, admin) intentionally omit the flag — phones
// get a runtime-only experience.
export const NAV_ITEMS = [
  {
    label: "My Tasks",
    href: "/tasks",
    icon: "Clock" as const,
    enabled: true,
    mobileVisible: true,
    requiredPermission: "tasks.view_own" as const,
  },
  {
    label: "Task Queue",
    href: "/tasks/queue",
    icon: "Users" as const,
    enabled: true,
    mobileVisible: true,
    requiredPermission: "tasks.manage_queue" as const,
  },
  {
    // Shown only to managers (anyone with a direct report): their reports' open tasks.
    label: "My Team",
    href: "/tasks/team",
    icon: "UserCheck" as const,
    enabled: true,
    mobileVisible: true,
    managerOnly: true,
    requiredPermission: "tasks.view_own" as const,
  },
  {
    label: "Task Tracker",
    href: "/tasks/assigned",
    icon: "Eye" as const,
    enabled: true,
    requiredPermission: "tasks.view_all" as const,
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
    icon: "TrendingUp" as const,
    enabled: true,
    requiredPermission: "workflows.view" as const,
  },
  {
    label: "Queue",
    href: "/automations/queue",
    icon: "ListOrdered" as const,
    enabled: true,
    requiredPermission: "workflows.view_runs" as const,
  },
  {
    label: "Schedules",
    href: "/automations/schedules",
    icon: "Clock" as const,
    enabled: true,
    requiredPermission: "workflows.view" as const,
  },
  {
    label: "Business Rules",
    href: "/automations/rules",
    icon: "Scale" as const,
    enabled: true,
    requiredPermission: "workflows.view" as const,
  },
  {
    label: "Email Templates",
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
    label: "Retention Policies",
    href: "/settings/governance?tab=retention",
    icon: "Settings" as const,
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
    label: "AI Agents",
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
    label: "Team",
    href: "/team",
    icon: "Users" as const,
    enabled: true,
    requiredPermission: "team.view_members" as const,
  },
  {
    label: "MCP",
    href: "/settings/mcp",
    icon: "Bot" as const,
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
