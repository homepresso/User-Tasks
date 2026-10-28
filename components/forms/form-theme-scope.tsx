'use client'

import { useMemo } from 'react'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import { formHeaderColors, formThemeFontHref, formThemeVars, paletteScopeVars, type FormThemeOverrides } from '@/lib/forms/form-theme'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { isDarkColor } from '@/lib/theme/colors'
import type { ThemeMode } from '@/lib/theme/schema'
import { cn } from '@/lib/utils'

/**
 * Wraps a form in its mini theme: the overrides laid onto the workspace
 * palette for the viewer's light/dark mode (made legible by the theme
 * renderer) as CSS custom properties on this element, the theme font and the
 * optional header. `mode` forces a palette (the designer's preview toggle).
 * Without overrides it renders a plain wrapper — the workspace theme.
 */
export function FormThemeScope({ overrides, mode, className, children, card = true, page = false }: {
  overrides: FormThemeOverrides | null | undefined
  mode?: ThemeMode
  className?: string
  children: React.ReactNode
  /** Draw the form card (background, border, radius). */
  card?: boolean
  /**
   * Also draw the page behind the card (the theme's page colour / gradient,
   * else a soft wash of the card colour): standalone form pages, the frame
   * of a task form, the designer preview.
   */
  page?: boolean
}) {
  const { theme, mode: appMode } = useWorkspaceTheme()
  const active = mode ?? appMode
  // A forced mode other than the viewer's (designer preview) also needs the workspace palette of that mode.
  const vars = useMemo(() => ({
    ...(mode && mode !== appMode ? paletteScopeVars(theme.colors[mode]) : {}),
    ...formThemeVars(overrides, theme.colors[active], active),
  }), [overrides, theme, active, mode, appMode])
  const fontHref = formThemeFontHref(overrides)
  const header = overrides?.header?.enabled ? overrides.header : null
  const banner = formHeaderColors(overrides)
  const logo = header?.logo_url ? resolveStorageUrl(header.logo_url) : null
  const themed = Boolean(overrides) || Boolean(mode) || page
  // Native controls (date pickers, select menus, scrollbars) follow the form's own light / dark.
  const cardBg = vars['--theme-card-bg']
  const colorScheme = cardBg ? (isDarkColor(cardBg) ? 'dark' : 'light') : mode

  const inner = (
    <div
      className={cn(card && themed && 'overflow-hidden border', className)}
      data-form-theme={overrides ? 'custom' : 'workspace'}
      data-form-density={overrides?.density ?? 'comfortable'}
      style={{
        ...vars,
        ...(colorScheme ? { colorScheme } : {}),
        ...(card && themed ? {
          backgroundColor: 'var(--theme-card-bg)',
          color: 'var(--theme-card-text)',
          borderColor: 'var(--theme-surface-border)',
          borderRadius: 'var(--theme-border-radius)',
        } : {}),
        ...(overrides?.font ? { fontFamily: 'var(--theme-font-sans)' } : {}),
      } as React.CSSProperties}
    >
      {/* Google Fonts stylesheet for a non-bundled family (the CSP already allows the workspace theme's fonts). */}
      {fontHref && <link rel="stylesheet" href={fontHref} />}
      {header && (header.title || header.subtitle || logo) && (
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={banner ? { backgroundColor: banner.background, color: banner.text } : { borderBottom: '1px solid var(--theme-surface-border)' }}
        >
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- workspace logo upload (own storage)
            <img src={logo} alt="" className="h-8 w-auto max-w-[120px] object-contain" />
          )}
          <div className="min-w-0">
            {header.title && <p className="text-base font-semibold leading-tight">{header.title}</p>}
            {header.subtitle && <p className="text-xs opacity-90 mt-0.5">{header.subtitle}</p>}
          </div>
        </div>
      )}
      <div className={cn(card && themed && 'p-5')}>{children}</div>
    </div>
  )
  if (!page) return inner
  return (
    <div
      className="rounded-2xl p-3 sm:p-6"
      data-form-page
      style={{
        ...vars,
        backgroundColor: 'var(--form-page-bg, color-mix(in srgb, var(--theme-card-bg) 88%, var(--theme-card-text) 12%))',
        backgroundImage: 'var(--form-page-image, none)',
        color: 'var(--form-page-text, var(--theme-card-text))',
      } as React.CSSProperties}
    >
      {inner}
    </div>
  )
}
