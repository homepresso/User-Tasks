"use client"

import { useCallback, useEffect } from "react"
import { usePathname } from "next/navigation"
import { useAppStore } from "@/stores/app-store"
import { useAppShellStore } from "@/stores/app-shell-store"
import { appSlugFromPath, effectiveSidebarCollapsed, reconcileOverride, toggleShellMenu } from "@/lib/apps/shell-collapse"

/**
 * The side menu's collapsed state and toggle, apps included
 * (lib/apps/shell-collapse.ts): folded inside an app, the person's own
 * preference everywhere else; the toggle inside an app only changes this visit.
 */
export function useShellSidebar(): { collapsed: boolean; toggle: () => void; inApp: boolean } {
  const pathname = usePathname()
  const appSlug = appSlugFromPath(pathname)
  const preference = useAppStore((s) => s.sidebarCollapsed)
  const setPreference = useAppStore((s) => s.setSidebarCollapsed)
  const override = useAppShellStore((s) => s.override)
  const setOverride = useAppShellStore((s) => s.setOverride)
  const autoCollapse = useAppShellStore((s) => (appSlug ? s.autoCollapse[appSlug] : undefined))

  // The visit ended (another app, or out of apps): forget its override.
  useEffect(() => {
    const next = reconcileOverride(override, appSlug)
    if (next !== override) setOverride(next)
  }, [appSlug, override, setOverride])

  const input = { preference, appSlug, autoCollapse, override: reconcileOverride(override, appSlug) }
  const collapsed = effectiveSidebarCollapsed(input)
  const toggle = useCallback(() => {
    const next = toggleShellMenu({ preference, appSlug, autoCollapse, override: reconcileOverride(override, appSlug) })
    if (next.preference !== preference) setPreference(next.preference)
    if (next.override !== override) setOverride(next.override)
  }, [preference, appSlug, autoCollapse, override, setPreference, setOverride])
  return { collapsed, toggle, inApp: !!appSlug }
}
