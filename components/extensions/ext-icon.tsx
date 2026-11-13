'use client'

/**
 * Icons of extension contributions: a Lucide name from this curated set
 * (static imports keep the bundle small; unknown names fall back to a
 * puzzle piece) or an inline SVG sanitised by core. Colour comes from the
 * surrounding text (currentColor), so icons follow the workspace theme.
 */

import {
  Activity, AlertTriangle, Archive, BadgeCheck, Bell, Blocks, BookOpen, Bot, Boxes, Briefcase, Building2, Calendar, CalendarClock,
  ChartBar, Check, CircleCheck, ClipboardList, Cloud, Cog, Database, Download, FileText, Files, Filter, Flag, Folder, FolderSync,
  Gauge, GitBranch, Globe, Hand, Heart, Inbox, Key, KeyRound, Layers, LayoutGrid, Link, List, ListChecks, Lock, Mail, Map,
  MessageSquare, MessageSquarePlus, Network, Newspaper, Package, PanelsTopLeft, Plug, Puzzle, Radio, RefreshCw, Repeat, Rocket,
  ScanSearch, Search, Send, Server, Settings, Share2, Shield, ShieldCheck, Sparkles, Star, Table, Tag, Upload, User, Users,
  Workflow, Wrench, Zap, type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import type { ExtensionIcon } from '@/lib/extensions/manifest'
import { iconName } from '@/lib/extensions/nodes'
import { sanitizeSvg } from '@/lib/sanitize-svg'
import { cn } from '@/lib/utils'

export const EXTENSION_ICONS: Record<string, LucideIcon> = {
  Activity, AlertTriangle, Archive, BadgeCheck, Bell, Blocks, BookOpen, Bot, Boxes, Briefcase, Building2, Calendar, CalendarClock,
  ChartBar, Check, CircleCheck, ClipboardList, Cloud, Cog, Database, Download, FileText, Files, Filter, Flag, Folder, FolderSync,
  Gauge, GitBranch, Globe, Hand, Heart, Inbox, Key, KeyRound, Layers, LayoutGrid, Link, List, ListChecks, Lock, Mail, Map,
  MessageSquare, MessageSquarePlus, Network, Newspaper, Package, PanelsTopLeft, Plug, Puzzle, Radio, RefreshCw, Repeat, Rocket,
  ScanSearch, Search, Send, Server, Settings, Share2, Shield, ShieldCheck, Sparkles, Star, Table, Tag, Upload, User, Users,
  Workflow, Wrench, Zap,
}

/** The Lucide component for a manifest icon name (fallback: Puzzle). */
export function extensionLucide(icon: ExtensionIcon | undefined): LucideIcon {
  return EXTENSION_ICONS[iconName(icon)] ?? Puzzle
}

export function ExtIcon({ icon, className }: { icon: ExtensionIcon | undefined; className?: string }) {
  const svg = icon && typeof icon === 'object' && 'svg' in icon ? icon.svg : null
  const safe = useMemo(() => (svg ? sanitizeSvg(svg) : null), [svg])
  if (safe) {
    return <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center [&>svg]:size-full', className)} dangerouslySetInnerHTML={{ __html: safe }} />
  }
  const Icon = extensionLucide(icon)
  return <Icon className={className} aria-hidden />
}
