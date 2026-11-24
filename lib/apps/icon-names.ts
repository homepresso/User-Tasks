import { customIconId } from './icon-svg'

/**
 * Every built-in icon name an app, page, widget, button, tile, tab or menu
 * entry may use (pure, client-safe). components/apps/app-icon.tsx draws them
 * (APP_ICONS + WIDGET_ICONS); __tests__/apps-polish.test.ts keeps the two
 * lists in step. Uploaded icons are `svg:<uuid>` tokens. Anything else
 * would silently fall back to the grid icon, so the app spec compiler
 * rejects it in plain language (lib/apps/spec.ts).
 */
export const BUILTIN_ICON_NAMES: readonly string[] = [
  'Activity', 'AlarmClock', 'AppWindow', 'ArrowRightLeft', 'Bell', 'BookOpen', 'Bot', 'Briefcase', 'BriefcaseBusiness', 'Building2', 'Calculator',
  'Calendar', 'CalendarClock', 'CalendarDays', 'ChartColumn', 'ChartPie', 'ChartSpline', 'ChevronsUpDown', 'CircleCheck', 'CircleHelp',
  'ClipboardCheck', 'ClipboardList', 'Cog', 'Columns3', 'Contact', 'DollarSign', 'Download', 'FileBarChart', 'FileInput', 'FilePen', 'FilePlus',
  'Files', 'FileText', 'Filter', 'Flag', 'Folder', 'Gauge', 'GitCommitVertical', 'Globe', 'GraduationCap', 'Grid2x2', 'Grid3x3', 'Hand', 'HardHat',
  'Heading', 'Headphones', 'HeartPulse', 'History', 'Hourglass', 'House', 'IdCard', 'Image', 'Inbox', 'KeyRound', 'Landmark', 'LayoutDashboard',
  'LayoutGrid', 'LayoutPanelTop', 'LifeBuoy', 'Link', 'ListChecks', 'ListFilter', 'ListTodo', 'Lock', 'Mail', 'MapPin', 'Megaphone', 'MessageSquare',
  'Minus', 'MousePointerClick', 'Network', 'OctagonAlert', 'Package', 'PanelLeft', 'PanelsTopLeft', 'PanelTop', 'Play', 'Plus', 'Receipt', 'Rocket',
  'Rss', 'Scale', 'Search', 'Settings', 'Sheet', 'Shield', 'ShoppingCart', 'Space', 'SquareKanban', 'Star', 'Table', 'TableProperties', 'Tag',
  'Target', 'Text', 'Timer', 'TrendingUp', 'Truck', 'Type', 'UserPlus', 'UserRound', 'Users', 'UsersRound', 'Video', 'Wrench', 'Zap',
]
const KNOWN = new Map(BUILTIN_ICON_NAMES.map((n) => [n.toLowerCase(), n]))
const EXACT = new Set(BUILTIN_ICON_NAMES)

/** A built-in icon name (exact case: the app draws it by that name) or an uploaded icon token. */
export function isKnownIcon(value: string): boolean {
  return EXACT.has(value) || !!customIconId(value)
}

/** The exact built-in name for a differently-cased one ("house" → "House"), or null. */
export function canonicalIcon(value: string): string | null {
  return KNOWN.get(value.toLowerCase()) ?? null
}

/** Up to n built-in names that look like `value` (for "did you mean"). */
export function similarIcons(value: string, n = 6): string[] {
  const v = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const score = (name: string) => {
    const k = name.toLowerCase()
    if (k.includes(v) || v.includes(k)) return 0
    let common = 0
    for (let i = 0; i < Math.min(k.length, v.length); i++) if (k[i] === v[i]) common++; else break
    return 10 - common
  }
  return [...BUILTIN_ICON_NAMES].sort((a, b) => score(a) - score(b)).slice(0, n)
}
