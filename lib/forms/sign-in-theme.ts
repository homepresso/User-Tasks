import { defaultWorkspaceTheme } from '@/lib/theme/presets'
import { themeFontsHref, themeStylesheet } from '@/lib/theme/to-css'
import type { WorkspaceTheme } from '@/lib/theme/schema'
import { PLATFORM_ACCENT, type FormSignInSettings } from './sign-in-page'

/**
 * The look of the form sign-in page (/form-login and its settings preview):
 * the design tokens the ten designs draw with, scoped to the page's root
 * (`[data-fsi-root]`), so the page never depends on the visitor's session
 * theme.
 *
 *  - Default (`use_workspace_theme` off): the UserTasks platform palette in
 *    its light mode — the cloud /login look (cream canvas, white panels,
 *    ink text, Fraunces headings) — with the accent colour setting on the
 *    buttons and coloured panels (ink when unset).
 *  - Workspace theme on: the workspace theme's tokens (colours, surfaces,
 *    text, radius, fonts, light / dark / auto mode, canvas image) and its
 *    primary colour as the accent; the accent setting is ignored.
 *
 * Pure and isomorphic (the server page and the client settings card both
 * call it). Only CSS text and a few display values come out: the public page
 * receives theme tokens, nothing else of the workspace.
 */

export const SIGN_IN_THEME_SCOPE = '[data-fsi-root]'

export interface SignInThemeStyle {
  /** Where the tokens come from. */
  source: 'usertasks' | 'workspace'
  /** A stylesheet declaring the tokens on SIGN_IN_THEME_SCOPE. */
  css: string
  /** Google Fonts stylesheet for a workspace theme's web fonts, or null. */
  fontsHref: string | null
  /** The accent (#rrggbb) the designs' coloured panels and buttons use. */
  accent: string
  /** Heading family: Fraunces (`display`, the UserTasks look) or the body sans. */
  headings: 'display' | 'sans'
}

const HEX_RE = /^#[0-9a-f]{6}$/i

/** The platform default theme pinned to light (the cloud sign-in pages are always light). */
function platformLight(): WorkspaceTheme {
  const theme = defaultWorkspaceTheme()
  return { ...theme, meta: { ...theme.meta, mode: 'light' } }
}

export function signInThemeStyle(settings: Pick<FormSignInSettings, 'use_workspace_theme' | 'accent_color'>, workspaceTheme: WorkspaceTheme | null | undefined): SignInThemeStyle {
  if (settings.use_workspace_theme && workspaceTheme) {
    const palette = workspaceTheme.meta.mode === 'dark' ? workspaceTheme.colors.dark : workspaceTheme.colors.light
    const primary = typeof palette.primary === 'string' && HEX_RE.test(palette.primary) ? palette.primary.toLowerCase() : PLATFORM_ACCENT
    return {
      source: 'workspace',
      css: themeStylesheet(workspaceTheme, { scope: SIGN_IN_THEME_SCOPE, important: false }),
      fontsHref: themeFontsHref(workspaceTheme),
      accent: primary,
      headings: workspaceTheme.typography.headingFont === 'display' ? 'display' : 'sans',
    }
  }
  const accent = typeof settings.accent_color === 'string' && HEX_RE.test(settings.accent_color) ? settings.accent_color.toLowerCase() : PLATFORM_ACCENT
  return {
    source: 'usertasks',
    css: themeStylesheet(platformLight(), { scope: SIGN_IN_THEME_SCOPE, important: false }),
    fontsHref: null,
    accent,
    headings: 'display',
  }
}
