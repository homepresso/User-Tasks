'use client'

import { useMemo } from 'react'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import { formHeaderColors, formThemeFontHref, formThemeVars, paletteScopeVars, type FormThemeOverrides } from '@/lib/forms/form-theme'
import { normalizeFormWidth } from '@/lib/forms/form-width'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { isDarkColor } from '@/lib/theme/colors'
import type { ThemeMode } from '@/lib/theme/schema'
import { cn } from '@/lib/utils'
import { FormMotionProvider, motionAttrs, usePrefersReducedMotion } from './form-motion'
import { motionLevel, type ResolvedFormAnimation } from '@/lib/forms/motion'

/**
 * Wraps a form in its mini theme: the overrides laid onto the workspace
 * palette for the viewer's light/dark mode (made legible by the theme
 * renderer) as CSS custom properties on this element, the theme font and the
 * optional header. `mode` forces a palette (the designer's preview toggle).
 * Without overrides it renders a plain wrapper — the workspace theme.
 */
export function FormThemeScope({ overrides, mode, className, children, card = true, page = false, motion }: {
  overrides: FormThemeOverrides | null | undefined
  /** The form's animation (lib/forms/motion.ts, formAnimation(layout)): the card rises in and the parts inside follow it. */
  motion?: ResolvedFormAnimation | null
  mode?: ThemeMode
  className?: string
  children: React.ReactNode
  /** Draw the form card (background, border, radius). */
  card?: boolean
  /**
   * A page surface (standalone form pages, the frame of a task form, the
   * designer preview): the card with elevation 1. `'viewport'` (public
   * links) also paints the theme's page colour / gradient over the whole
   * viewport behind it.
   */
  page?: boolean | 'viewport'
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
  const themed = Boolean(overrides) || Boolean(mode) || Boolean(page)
  // Native controls (date pickers, select menus, scrollbars) follow the form's own light / dark.
  const cardBg = vars['--theme-card-bg']
  const colorScheme = cardBg ? (isDarkColor(cardBg) ? 'dark' : 'light') : mode
  // Form width (lib/forms/form-width.ts): narrow caps the scope here; wide / full widen the surface's container.
  const width = normalizeFormWidth(overrides?.form_width)
  const narrow = width === 'narrow' ? 'mx-auto w-full max-w-xl' : null
  // The theme's own page colour / gradient (form-theme.ts pageVars).
  const ownPage = Boolean(vars['--form-page-bg'])
  const reduced = usePrefersReducedMotion()
  const motionProps = motion ? { ...motionAttrs(motionLevel(motion.style, reduced)), 'data-fm-card': '' } : {}

  const inner = (
    <div
      className={cn(card && themed && 'overflow-hidden border', card && page && 'shadow-elev-1', !page && narrow, className)}
      data-form-theme={overrides ? 'custom' : 'workspace'}
      data-form-width={width}
      data-form-density={overrides?.density ?? 'comfortable'}
      data-form-font={overrides?.font ? '' : undefined}
      {...motionProps}
      style={{
        ...vars,
        ...(colorScheme ? { colorScheme } : {}),
        ...(card && themed ? {
          backgroundColor: 'var(--theme-card-bg)',
          color: 'var(--theme-card-text)',
          // The card's hairline is the subtle border (in a themed scope the surface border is the 3:1 input border).
          borderColor: 'var(--ds-border-subtle)',
          borderRadius: 'var(--theme-border-radius)',
        } : {}),
        ...(overrides?.font ? { fontFamily: 'var(--theme-font-sans)' } : {}),
      } as React.CSSProperties}
    >
      {/* Google Fonts stylesheet for a non-bundled family (the CSP already allows the workspace theme's fonts). */}
      {fontHref && <link rel="stylesheet" href={fontHref} />}
      {header && (header.title || header.subtitle || logo) && (
        <div
          className={cn('flex items-center gap-3 px-5 py-4', !banner && 'border-b border-border')}
          style={banner ? { backgroundColor: banner.background, color: banner.text } : undefined}
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
      <div className={cn(card && themed && (page ? 'p-5 sm:p-7' : 'p-5'))}>{children}</div>
    </div>
  )
  if (!page) return <FormMotionProvider value={motion}>{inner}</FormMotionProvider>
  // One card (elevation 1) straight on the canvas — never a tinted frame around it (UI polish §5.9).
  // A theme's own page colour / gradient paints the canvas where the form owns it: the whole
  // viewport of a public link (/p/); in the app the canvas is the app's (the designer previews it
  // behind the card with useFormPageCanvas).
  const canvas = page === 'viewport' && ownPage
    ? <div aria-hidden className="pointer-events-none fixed inset-0" style={{ backgroundColor: vars['--form-page-bg'], backgroundImage: vars['--form-page-image'] }} data-form-canvas />
    : null
  return (
    <FormMotionProvider value={motion}>
      <div className={cn(canvas && 'relative', narrow)} data-form-page={canvas ? 'canvas' : 'plain'}>
        {canvas}
        {canvas ? <div className="relative">{inner}</div> : inner}
      </div>
    </FormMotionProvider>
  )
}

/**
 * The theme's page colour / gradient as a background style (null without
 * one): the designer paints its preview pane with it, behind the card.
 */
export function useFormPageCanvas(overrides: FormThemeOverrides | null | undefined, mode?: ThemeMode): React.CSSProperties | null {
  const { theme, mode: appMode } = useWorkspaceTheme()
  const active = mode ?? appMode
  return useMemo(() => {
    const vars = formThemeVars(overrides, theme.colors[active], active)
    if (!vars['--form-page-bg']) return null
    return { backgroundColor: vars['--form-page-bg'], backgroundImage: vars['--form-page-image'] }
  }, [overrides, theme, active])
}
