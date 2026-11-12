import { CalendarClock, Clapperboard, ClipboardCheck, ClipboardList, Code2, FormInput, Handshake, Package, Puzzle, Radio, Receipt, ShieldCheck, Users, Webhook, Workflow, Building2, type LucideIcon } from "lucide-react"
import type { GalleryCategoryId, GalleryTrigger } from "@/lib/gallery/types"

/**
 * The small icon sets (categories, triggers) the in-app picker needs, kept
 * apart from gallery-ui's full icon map so the app bundle stays small.
 */
export const CATEGORY_ICONS: Record<GalleryCategoryId, LucideIcon> = {
  "hr-people": Users,
  finance: Receipt,
  "it-security": ShieldCheck,
  "customer-sales": Handshake,
  "operations-compliance": ClipboardCheck,
  workplace: Building2,
  "headless-integration": Code2,
  "surveys-assessments": ClipboardList,
  "media-evidence": Clapperboard,
  "form-controls": Puzzle,
  "workflow-actions": Workflow,
}

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category as GalleryCategoryId] ?? Package
}

export const TRIGGER_ICONS: Record<GalleryTrigger, LucideIcon> = { form: FormInput, api: Webhook, schedule: CalendarClock, event: Radio }
