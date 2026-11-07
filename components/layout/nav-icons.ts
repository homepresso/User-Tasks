import {
  Activity, Archive, Blocks, Bot, Boxes, Building2, CalendarClock, ClipboardPen, Clock, Database, Eye, FileBarChart, FileText, House, Inbox,
  LayoutGrid, ListChecks, ListOrdered, Mail, Network, Scale, Server, Settings, UserCheck, Users, Workflow,
  type LucideIcon,
} from 'lucide-react'

/** Icons named by the nav lists in lib/constants (sidebar, mobile drawer, command palette). */
export const NAV_ICONS: Record<string, LucideIcon> = {
  Home: House, ListChecks, Inbox, UserCheck, Eye, Users, Clock, CalendarClock, Workflow, ListOrdered, Scale, Mail,
  FileText, ClipboardPen, Archive, Network, Blocks, Boxes, Bot, Activity, Server, Settings, Database, FileBarChart, Building2,
}

export function navIcon(name: string): LucideIcon {
  return NAV_ICONS[name] ?? LayoutGrid
}
