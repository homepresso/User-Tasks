"use client"

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react"
import { cacheableVars } from "@/lib/theme/to-css"
import { DEFAULT_CHART_COLORS, defaultWorkspaceTheme } from "@/lib/theme/presets"
import { canvasMode, resolvePaletteMode, themeAttributes } from "@/lib/theme/resolve"
import type { ThemeMode, ThemePalette, WorkspaceTheme } from "@/lib/theme/schema"
import { resolveStorageUrl } from "@/lib/storage/refs"

interface WorkspaceThemeState {
  theme: WorkspaceTheme
  /** Palette in use (forced by the theme, or the OS setting). */
  mode: ThemeMode
  palette: ThemePalette
  /** Whether the canvas is dark (what `data-theme-mode` says). */
  canvas: ThemeMode
}

const WorkspaceThemeContext = createContext<WorkspaceThemeState | null>(null)

const DARK_QUERY = "(prefers-color-scheme: dark)"

function subscribeOsDark(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

/** OS dark-mode preference (false on the server). */
function useOsDark(): boolean {
  return useSyncExternalStore(subscribeOsDark, () => window.matchMedia(DARK_QUERY).matches, () => false)
}

/**
 * Applies the workspace theme the dashboard layout rendered on the server.
 *
 * The CSS variables themselves arrive in the server-rendered <style> (light
 * palette, plus a prefers-color-scheme block for the dark one), so there is
 * nothing to compute before first paint. This provider only sets the <html>
 * attributes that need JS — `data-theme-mode` (Tailwind's `dark:` variant)
 * follows the OS unless the theme forces a mode — and caches the colours for
 * the pre-paint bootstrap script on pages outside the dashboard.
 */
export function WorkspaceThemeProvider({ theme, children }: { theme: WorkspaceTheme; children: React.ReactNode }) {
  const osDark = useOsDark()
  const state = useMemo<WorkspaceThemeState>(() => {
    const mode = resolvePaletteMode(theme, osDark)
    return { theme, mode, palette: theme.colors[mode], canvas: canvasMode(theme, osDark) }
  }, [theme, osDark])

  useEffect(() => {
    const root = document.documentElement
    for (const [name, value] of Object.entries(themeAttributes(theme, osDark))) {
      if (value === null) root.removeAttribute(name)
      else root.setAttribute(name, value)
    }
    try {
      sessionStorage.setItem("theme_css_cache", JSON.stringify(cacheableVars(theme, state.mode)))
      sessionStorage.setItem("theme_id", theme.meta.basePreset ?? "custom")
      sessionStorage.setItem("theme_mode", state.canvas)
      sessionStorage.setItem("theme_headings", theme.typography.headingFont)
      // Pre-workspace-theme caches (personal theme / policy) are obsolete.
      sessionStorage.removeItem("tenant_theme_policy")
    } catch {}
  }, [theme, osDark, state.mode, state.canvas])

  return <WorkspaceThemeContext.Provider value={state}>{children}</WorkspaceThemeContext.Provider>
}

let fallback: WorkspaceThemeState | null = null

function defaultState(): WorkspaceThemeState {
  if (!fallback) {
    const theme = defaultWorkspaceTheme()
    fallback = { theme, mode: "light", palette: theme.colors.light, canvas: "light" }
  }
  return fallback
}

/** Current workspace theme; the platform default outside the dashboard. */
export function useWorkspaceTheme(): WorkspaceThemeState {
  return useContext(WorkspaceThemeContext) ?? defaultState()
}

/** Chart series colours from the theme palette (default palette outside the dashboard). */
export function useThemeChartColors(): string[] {
  const ctx = useContext(WorkspaceThemeContext)
  return ctx?.palette.chart ?? DEFAULT_CHART_COLORS
}

/**
 * Sidebar brand: the theme's logo for the active mode (falling back to the
 * workspace logo upload) and its optional wordmark text.
 */
export function useWorkspaceBrand(workspaceLogoUrl: string | null): { logoUrl: string | null; wordmark: string | null } {
  const { theme, canvas } = useWorkspaceTheme()
  const b = theme.branding
  const themed = canvas === "dark" ? (b.logoDark ?? b.logoLight) : (b.logoLight ?? b.logoDark)
  return { logoUrl: resolveStorageUrl(themed ?? workspaceLogoUrl), wordmark: b.wordmark || null }
}
