/**
 * Turning a stored `workspace_themes.theme` value into the theme to render,
 * and picking the palette for the viewer's light/dark setting.
 */

import { isDarkColor } from './colors'
import { defaultWorkspaceTheme, presetToWorkspaceTheme } from './presets'
import { WorkspaceThemeSchema, type ThemeMode, type ThemePalette, type WorkspaceTheme } from './schema'

/**
 * Stored value → theme. Accepts a full theme, or the `{ "base_preset": "<id>" }`
 * stub the migration and the tenant-insert trigger write (expanded here, so
 * the SQL never has to know the preset contents). Anything unreadable falls
 * back to the platform default so a bad row can't break the app shell.
 */
export function parseStoredTheme(value: unknown): WorkspaceTheme {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const parsed = WorkspaceThemeSchema.safeParse(value)
    if (parsed.success) return parsed.data
    const stub = (value as Record<string, unknown>).base_preset
    if (typeof stub === 'string') return presetToWorkspaceTheme(stub) ?? defaultWorkspaceTheme()
  }
  return defaultWorkspaceTheme()
}

/** Palette the viewer sees: forced by `meta.mode`, otherwise their OS setting. */
export function resolvePaletteMode(theme: WorkspaceTheme, osDark: boolean): ThemeMode {
  if (theme.meta.mode === 'light' || theme.meta.mode === 'dark') return theme.meta.mode
  return osDark ? 'dark' : 'light'
}

export function activePalette(theme: WorkspaceTheme, osDark: boolean): ThemePalette {
  return theme.colors[resolvePaletteMode(theme, osDark)]
}

/**
 * `data-theme-mode` (drives Tailwind's `dark:` variant): whether the active
 * palette paints a dark canvas — the legacy getThemeMode rule, so light
 * presets stay light even when the OS is dark.
 */
export function canvasMode(theme: WorkspaceTheme, osDark: boolean): ThemeMode {
  return isDarkColor(activePalette(theme, osDark).surface) ? 'dark' : 'light'
}

/** Attributes the client sets on <html> for the theme. */
export function themeAttributes(theme: WorkspaceTheme, osDark: boolean): Record<string, string | null> {
  return {
    'data-theme': theme.meta.basePreset ?? 'custom',
    'data-theme-mode': canvasMode(theme, osDark),
    'data-theme-decoration': theme.meta.decorationPreset ?? null,
    'data-sidebar-style': theme.chrome.sidebar.style,
    'data-density': theme.layout.density,
    'data-theme-headings': theme.typography.headingFont,
  }
}
