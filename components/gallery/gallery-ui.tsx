import {
  AlarmClock, Bot, Briefcase, CalendarCheck, CalendarClock, ClipboardCheck, ClipboardList, Code2, Database, FileCheck2, FileSignature,
  FileText, FormInput, GitPullRequest, Handshake, KeyRound, Laptop, LogOut, MessageSquareWarning, Package, Plane, Radio, Receipt,
  RefreshCw, Scale, Search, ShieldAlert, ShieldCheck, ShoppingCart, Siren, Target, Truck, UserCheck, UserMinus, UserPlus, Users, Webhook, Workflow,
  BadgePercent, Building2, CalendarDays, FileClock, PackageCheck, UserLock, UsersRound, Network, FileOutput, BotMessageSquare, ArrowLeftRight, DatabaseZap,
  Car, DoorOpen, GraduationCap, Boxes, Timer, HandCoins, Ticket, CalendarRange, Presentation, HardHat, ClipboardPen, FileWarning, Wallet,
  BadgeCheck, Cloud, Landmark, BriefcaseBusiness, MailCheck, ListChecks, Warehouse, MonitorSmartphone, Contact, IdCard, Flag, ScrollText,
  Gauge, Server, UserCog, BookOpenCheck, Award, Archive, Store, Factory, Banknote, FileSpreadsheet, Building,
  type LucideIcon,
} from "lucide-react"
import { createElement } from "react"
import type { GalleryCategoryId, GalleryNeed, GalleryOrigin, GalleryTrigger } from "@/lib/gallery/types"
import { GALLERY_NEEDS, GALLERY_ORIGINS, GALLERY_TRIGGERS, NATIVE_BADGE } from "@/lib/gallery/types"

/** Card icons by gallery.json `icon` (kebab-case lucide names); unknown names fall back to the category icon. */
const ICONS: Record<string, LucideIcon> = {
  "alarm-clock": AlarmClock, bot: Bot, briefcase: Briefcase, "calendar-check": CalendarCheck, "calendar-clock": CalendarClock,
  "clipboard-check": ClipboardCheck, "clipboard-list": ClipboardList, code: Code2, database: Database, "file-check": FileCheck2,
  "file-signature": FileSignature, "file-text": FileText, form: FormInput, "git-pull-request": GitPullRequest, handshake: Handshake,
  "key-round": KeyRound, key: KeyRound, laptop: Laptop, "log-out": LogOut, "message-square-warning": MessageSquareWarning, package: Package,
  plane: Plane, radio: Radio, receipt: Receipt, "refresh-cw": RefreshCw, scale: Scale, search: Search, "shield-alert": ShieldAlert,
  "shield-check": ShieldCheck, "shopping-cart": ShoppingCart, siren: Siren, target: Target, truck: Truck, "user-check": UserCheck,
  "user-minus": UserMinus, "user-plus": UserPlus, users: Users, webhook: Webhook, workflow: Workflow,
  "badge-percent": BadgePercent, "building-2": Building2, "calendar-days": CalendarDays, "file-clock": FileClock, "package-check": PackageCheck,
  "user-lock": UserLock, "users-round": UsersRound, network: Network, "file-output": FileOutput, "bot-message-square": BotMessageSquare,
  "arrow-left-right": ArrowLeftRight, "database-zap": DatabaseZap,
  car: Car, "door-open": DoorOpen, "graduation-cap": GraduationCap, boxes: Boxes, timer: Timer, "hand-coins": HandCoins, ticket: Ticket,
  "calendar-range": CalendarRange, presentation: Presentation, "hard-hat": HardHat, "clipboard-pen": ClipboardPen, "file-warning": FileWarning,
  wallet: Wallet, "badge-check": BadgeCheck, cloud: Cloud, landmark: Landmark, "briefcase-business": BriefcaseBusiness, "mail-check": MailCheck,
  "list-checks": ListChecks, warehouse: Warehouse, "monitor-smartphone": MonitorSmartphone, contact: Contact, "id-card": IdCard, flag: Flag,
  "scroll-text": ScrollText, gauge: Gauge, server: Server, "user-cog": UserCog, "book-open-check": BookOpenCheck, award: Award, archive: Archive,
  store: Store, factory: Factory, banknote: Banknote, "file-spreadsheet": FileSpreadsheet, building: Building,
}

/** Icon names a gallery.json may use. */
export const GALLERY_ICON_NAMES = Object.keys(ICONS)

const CATEGORY_ICONS: Record<GalleryCategoryId, LucideIcon> = {
  "hr-people": Users,
  finance: Receipt,
  "it-security": ShieldCheck,
  "customer-sales": Handshake,
  "operations-compliance": ClipboardCheck,
  workplace: Building2,
  "headless-integration": Code2,
}

export function packageIcon(icon: string | null | undefined, category: GalleryCategoryId): LucideIcon {
  return (icon && ICONS[icon]) || CATEGORY_ICONS[category] || Package
}

/** The package's card icon (looked up from a static map, so it is not a component created during render). */
export function PackageIcon({ icon, category, size }: { icon: string | null | undefined; category: GalleryCategoryId; size: number }) {
  return createElement(packageIcon(icon, category), { size, "aria-hidden": true })
}

export const TRIGGER_ICONS: Record<GalleryTrigger, LucideIcon> = { form: FormInput, api: Webhook, schedule: CalendarClock, event: Radio }

const TRIGGER_STYLE: Record<GalleryTrigger, string> = {
  form: "bg-[#B08A54]/[0.14] text-[#6F522B] ring-[#B08A54]/30",
  api: "bg-[#17150F] text-[#FAF8F3] ring-[#17150F]",
  schedule: "bg-[#4F7A5B]/[0.12] text-[#355A40] ring-[#4F7A5B]/30",
  event: "bg-[#4E6E8E]/[0.12] text-[#34506B] ring-[#4E6E8E]/30",
}

export function TriggerBadge({ trigger, size = "sm" }: { trigger: GalleryTrigger; size?: "sm" | "md" }) {
  const Icon = TRIGGER_ICONS[trigger]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${TRIGGER_STYLE[trigger]} ${size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"}`}>
      <Icon size={size === "md" ? 14 : 12} aria-hidden="true" />
      {GALLERY_TRIGGERS[trigger].badge}
    </span>
  )
}

export function NeedsChips({ needs, label = "Needs" }: { needs: GalleryNeed[]; label?: string }) {
  if (!needs.length) return <p className="text-xs text-[#6E6759]">No external systems needed</p>
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-[#6E6759]">
      <span className="font-semibold text-[#4A463E]">{label}:</span>
      {needs.map((need) => (
        <span key={need} title={GALLERY_NEEDS[need]?.description} className="rounded-md border border-[#1B1916]/[0.1] bg-[#FAF8F3] px-1.5 py-0.5 font-medium text-[#4A463E]">{GALLERY_NEEDS[need]?.label ?? need}</span>
      ))}
    </p>
  )
}

export const DIFFICULTY_LABEL: Record<string, string> = { starter: "Starter", intermediate: "Intermediate", advanced: "Advanced" }

/** Official (built by the UserTasks team) or Community (shared by a user, approved by a moderator). */
export function OriginBadge({ source, size = "sm" }: { source: GalleryOrigin; size?: "sm" | "md" }) {
  const community = source === "community"
  return (
    <span title={GALLERY_ORIGINS[source].description} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${community ? "bg-[#6B4E8E]/[0.1] text-[#4F3870] ring-[#6B4E8E]/30" : "bg-[#17150F]/[0.06] text-[#33302A] ring-[#17150F]/15"} ${size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]"}`} data-testid={`origin-${source}`}>
      {createElement(community ? UsersRound : BadgeCheck, { size: size === "md" ? 14 : 11, "aria-hidden": true })}
      {GALLERY_ORIGINS[source].label}
    </span>
  )
}

/** "No integrations needed": built-in features only, installs complete with nothing to configure. */
export function NativeBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <span title={NATIVE_BADGE.description} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset bg-[#4F7A5B]/[0.12] text-[#2F5A3B] ring-[#4F7A5B]/30 ${size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]"}`} data-testid="native-badge">
      {createElement(Package, { size: size === "md" ? 14 : 11, "aria-hidden": true })}
      {NATIVE_BADGE.label}
    </span>
  )
}

/** The third-party systems a package talks to (Workday, SAP S/4HANA, …). */
export function SystemChips({ systems }: { systems: string[] }) {
  if (!systems.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1.5" data-testid="system-chips">
      {systems.map((system) => (
        <span key={system} className="inline-flex items-center gap-1 rounded-md bg-[#4E6E8E]/[0.1] px-1.5 py-0.5 text-[11px] font-semibold text-[#2E4B67] ring-1 ring-inset ring-[#4E6E8E]/25">
          {createElement(Building2, { size: 11, "aria-hidden": true })}{system}
        </span>
      ))}
    </span>
  )
}
