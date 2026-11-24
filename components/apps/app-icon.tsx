"use client"

import {
  AppWindow, Briefcase, Building2, Calendar, ChartColumn, ChartPie, ClipboardList, FileText, Folder, Gauge, GraduationCap, Headphones,
  HeartPulse, House, Inbox, Landmark, LayoutDashboard, LayoutGrid, ListChecks, Package, Receipt, Rocket, Scale, Shield, ShoppingCart,
  Star, Truck, Users, Wrench, History, Heading, Image, Link, MousePointerClick, Table, Timer, Type,
  Activity, AlarmClock, ArrowRightLeft, Bell, Bot, BriefcaseBusiness, CalendarDays, ChartSpline, ChevronsUpDown, CircleHelp, Columns3, Contact, Cog,
  FileBarChart, FileInput, Filter, GitCommitVertical, Globe, Grid2x2, Grid3x3, Hand, Hourglass, IdCard, KeyRound, LayoutPanelTop, ListFilter, Lock, Mail,
  MapPin, Megaphone, MessageSquare, Minus, Network, OctagonAlert, PanelLeft, PanelTop, PanelsTopLeft, Play, Rss, Search, Settings, Sheet, Space,
  Tag, Target, TableProperties, TrendingUp, UserRound, UsersRound, Video, Zap,
  BookOpen, Calculator, CalendarClock, CircleCheck, ClipboardCheck, DollarSign, Download, FilePen, FilePlus, Files, Flag, HardHat, LifeBuoy,
  ListTodo, Plus, SquareKanban, UserPlus,
  type LucideIcon, type LucideProps,
} from "lucide-react"
import { createElement, forwardRef, type CSSProperties } from "react"
import { useQuery } from "@tanstack/react-query"
import { serverQuery } from "@/lib/server-read"
import { customIconId } from "@/lib/apps/icon-svg"
import { resolveStorageUrl } from "@/lib/storage/refs"
import { cn } from "@/lib/utils"

/**
 * App and page icons (lucide, by name — apps.icon / app_pages.icon) and the
 * app's colour tile. Colours: the app's accent when it has one, otherwise
 * the workspace primary; text on the tile uses the theme's on-primary colour
 * when no accent is set.
 */

export const APP_ICONS: Record<string, LucideIcon> = {
  LayoutGrid, AppWindow, LayoutDashboard, Briefcase, Building2, Calendar, ChartColumn, ChartPie, ClipboardList, FileText, Folder, Gauge,
  GraduationCap, Headphones, HeartPulse, House, Inbox, Landmark, ListChecks, Package, Receipt, Rocket, Scale, Shield, ShoppingCart,
  Star, Truck, Users, Wrench, Bell, Bot, CalendarDays, CircleHelp, Cog, Contact, Globe, Hand, KeyRound, Lock, Mail, MapPin, Megaphone,
  MessageSquare, Play, Search, Settings, Tag, Target, TrendingUp, UserRound, Video, Zap,
  // Common button / KPI icons (the app spec guide and the gallery apps use them).
  Plus, Download, ClipboardCheck, CircleCheck, ListTodo, SquareKanban, BookOpen, LifeBuoy, DollarSign, Calculator, CalendarClock, Files,
  FilePlus, FilePen, Flag, HardHat, UserPlus,
}

/** Widget catalogue icons (lib/apps/widgets.ts WIDGET_CATALOG.icon). */
export const WIDGET_ICONS: Record<string, LucideIcon> = {
  MousePointerClick, ListChecks, Timer, Gauge, ChartColumn, Table, History, Heading, Text: Type, Type, Image, Link,
  Activity, AlarmClock, AppWindow, ArrowRightLeft, Bot, BriefcaseBusiness, CalendarDays, ChartPie, ChartSpline, ChevronsUpDown, Columns3, Contact,
  FileBarChart, FileInput, Filter, GitCommitVertical, Grid2x2, Grid3x3, Hourglass, IdCard, Inbox, LayoutGrid, LayoutPanelTop, ListFilter,
  Megaphone, Minus, Network, OctagonAlert, PanelLeft, PanelTop, PanelsTopLeft, Play, Rss, Search, Sheet, Space, TableProperties, Target,
  TrendingUp, Users, UsersRound, Video,
}

export const APP_ICON_NAMES = Object.keys(APP_ICONS)

export interface CustomIconInfo { id: string; token: string; name: string; url: string; tint: boolean }

/** The workspace's uploaded icons (one cached read). */
export function useCustomIcons(enabled = true) {
  return useQuery({ queryKey: ["apps", "icons"], enabled, queryFn: async () => ((await serverQuery("apps.icons", {})) ?? []) as CustomIconInfo[], staleTime: 300_000 })
}

/**
 * An uploaded SVG icon, never inlined: an <img> (its own colours), or —
 * "Use theme colour" — a CSS mask filled with currentColor, so a single-
 * colour icon follows the text / app colour in light and dark.
 */
export function CustomIcon({ id, className, style, ...rest }: { id: string } & LucideProps) {
  const icons = useCustomIcons()
  const icon = icons.data?.find((i) => i.id === id)
  const label = (rest as { "aria-label"?: string })["aria-label"]
  const hidden = (rest as { "aria-hidden"?: boolean | "true" })["aria-hidden"]
  if (!icon) return <span className={cn("inline-block rounded-sm bg-current/20", className)} style={style as CSSProperties} aria-hidden />
  const url = resolveStorageUrl(icon.url)
  if (icon.tint) {
    return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={hidden} className={cn("inline-block shrink-0", className)} style={{ ...(style as CSSProperties), backgroundColor: "currentColor", WebkitMaskImage: `url("${url}")`, maskImage: `url("${url}")`, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center" }} data-custom-icon={id} />
  }
  // eslint-disable-next-line @next/next/no-img-element -- sanitised SVG from the workspace icon library, drawn as an image (never inlined)
  return <img src={url} alt={label ?? ""} aria-hidden={hidden} className={cn("shrink-0 object-contain", className)} style={style as CSSProperties} data-custom-icon={id} />
}

const customComponents = new Map<string, LucideIcon>()
function customComponent(id: string): LucideIcon {
  let c = customComponents.get(id)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(function Custom(props, _ref) { void _ref; return <CustomIcon id={id} {...props} /> }) as unknown as LucideIcon
    customComponents.set(id, c)
  }
  return c
}

export function appIcon(name: string | null | undefined): LucideIcon {
  const custom = customIconId(name)
  if (custom) return customComponent(custom)
  return (name && (APP_ICONS[name] ?? WIDGET_ICONS[name])) || LayoutGrid
}

/** Black or white text for a #rrggbb background (WCAG relative luminance). */
export function readableOn(hex: string): "#000000" | "#ffffff" {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return "#ffffff"
  const lin = (c: string) => {
    const v = parseInt(c, 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3])
  return l > 0.179 ? "#000000" : "#ffffff"
}

/** An icon by name (built-in or uploaded), drawn without creating a component during render. */
export function AppIconGlyph({ name, className }: { name: string | null | undefined; className?: string }) {
  return createElement(appIcon(name), { className, "aria-hidden": true })
}

export function AppIconTile({ icon, color, size = "md", className }: { icon: string | null | undefined; color: string | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  const style: CSSProperties | undefined = color ? { background: color, color: readableOn(color) } : undefined
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        !color && "bg-primary text-primary-fg",
        size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-8",
        className,
      )}
      style={style}
    >
      {createElement(appIcon(icon), { className: size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4" })}
    </span>
  )
}

/**
 * CSS variables that layer an app's accent colour on the workspace theme
 * (inside the app only): the accent tokens (accent, accent-text,
 * accent-wash) take the app colour; primary stays the workspace's.
 */
export function appAccentStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined
  return {
    "--theme-accent": color,
    "--app-accent": color,
    "--app-accent-fg": readableOn(color),
    "--app-accent-wash": `color-mix(in oklab, ${color} 14%, transparent)`,
  } as CSSProperties
}
