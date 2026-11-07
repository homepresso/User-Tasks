import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { LogoMark } from '@/components/brand/logo'
import { shade, signInDesign, type FormSignInSettings, type SignInColors } from '@/lib/forms/sign-in-page'

/**
 * The ten form sign-in page designs (lib/forms/sign-in-page.ts
 * SIGN_IN_DESIGNS). Pure markup: no hooks, no data. Layouts respond to
 * their container (Tailwind container queries), not the viewport, so the
 * settings preview's desktop / mobile toggle shows the real thing.
 *
 * Surfaces, text and borders are design tokens (bg-bg, bg-panel, text-fg,
 * border-border…), declared on the page root by FormSignInScreen from
 * lib/forms/sign-in-theme.ts: the UserTasks light palette by default, the
 * workspace theme (light, dark or auto) when the page uses it. Coloured
 * panels and buttons use the accent; text on it uses `onAccent` (the better
 * of white / ink), links the accent darkened (light panels) or lightened
 * (dark panels) to 4.5:1 — signInColors. Design 8 (Dark elegant) keeps its
 * own dark palette. No external images: patterns are CSS gradients.
 *
 * Design 1 (the default) is the UserTasks look — the cloud /login page's
 * brand panel, Fraunces headline and clean form — with the UserTasks logo
 * until the workspace uploads its own.
 */

export type PanelTone = 'light' | 'dark'

export interface SignInLayoutProps {
  design: number
  settings: FormSignInSettings
  colors: SignInColors
  /** The logo's URL (resolved), or null for the workspace name (design 1: the UserTasks logo). */
  logoUrl: string | null
  workspaceName: string | null
  /** The form, drawn for the panel it sits on. */
  form: (tone: PanelTone) => ReactNode
  /** Heading family: Fraunces (the UserTasks look) or the theme's sans. */
  headings?: 'display' | 'sans'
  /** The settings preview: fill the preview box instead of the viewport. */
  preview?: boolean
}

/** The UserTasks wordmark in theme colours (ink and bronze in the UserTasks palette; readable on a dark workspace theme too). */
export function UserTasksBrand({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center font-sans font-bold tracking-tight" style={{ gap: size * 0.3, lineHeight: 1 }} data-sign-in-usertasks-logo>
      <LogoMark size={size} title="UserTasks" />
      <span aria-hidden className="text-fg" style={{ fontSize: size * 0.72 }}>
        user<span style={{ color: 'var(--theme-accent-text, #977443)' }}>tasks</span>
      </span>
    </span>
  )
}

function Brand({ logoUrl, name, onColor, size = 'md' }: { logoUrl: string | null; name: string | null; onColor?: string; size?: 'sm' | 'md' | 'lg' }) {
  const h = size === 'lg' ? 'h-12' : size === 'sm' ? 'h-7' : 'h-9'
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- the workspace's own upload
    return <img src={logoUrl} alt={name ? `${name} logo` : 'Logo'} className={cn(h, 'w-auto max-w-[200px] object-contain')} data-sign-in-logo />
  }
  if (!name) return null
  return (
    <span className={cn('inline-flex items-center gap-2.5 font-semibold tracking-tight', size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base')} style={onColor ? { color: onColor } : undefined} data-sign-in-brand>
      <span aria-hidden className={cn('inline-flex items-center justify-center rounded-lg text-sm font-bold', size === 'sm' ? 'size-7' : 'size-9')}
        style={{ backgroundColor: 'var(--fsi-accent)', color: 'var(--fsi-on-accent)', boxShadow: onColor ? `0 0 0 1px ${onColor}55` : undefined }}>
        {name.trim().charAt(0).toUpperCase() || '·'}
      </span>
      {name}
    </span>
  )
}

function Footer({ settings, tone, className }: { settings: FormSignInSettings; tone: PanelTone; className?: string }) {
  if (!settings.footer_text && !settings.support_link_url) return null
  return (
    <div className={cn('mt-6 space-y-1 text-xs leading-relaxed', tone === 'dark' ? 'text-zinc-400' : 'text-fg-muted', className)} data-sign-in-footer>
      {settings.footer_text && <p className="whitespace-pre-line">{settings.footer_text}</p>}
      {settings.support_link_url && (
        <p>
          <a href={settings.support_link_url} target="_blank" rel="noopener noreferrer"
            className="font-medium underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ color: 'var(--fsi-ink)', outlineColor: 'var(--fsi-ink)' }}>
            {settings.support_link_label || 'Get help'}
          </a>
        </p>
      )}
    </div>
  )
}

function Heading({ settings, tone, headings, size = 'md', center = false, onColor }: { settings: FormSignInSettings; tone: PanelTone; headings: 'display' | 'sans'; size?: 'sm' | 'md' | 'lg'; center?: boolean; onColor?: string }) {
  return (
    <div className={cn(center && 'text-center')}>
      <h1 className={cn('font-semibold tracking-tight text-balance', headings === 'display' ? 'font-display' : 'font-sans',
        size === 'lg' ? 'text-3xl leading-tight @3xl:text-4xl' : size === 'sm' ? 'text-lg' : 'text-2xl',
        !onColor && (tone === 'dark' ? 'text-zinc-50' : 'text-fg'))}
        style={onColor ? { color: onColor } : undefined} data-sign-in-heading>
        {settings.heading}
      </h1>
      {settings.subheading && (
        <p className={cn('mt-2 leading-relaxed', size === 'sm' ? 'text-xs' : 'text-sm', !onColor && (tone === 'dark' ? 'text-zinc-400' : 'text-fg-muted'))}
          style={onColor ? { color: onColor, opacity: 0.9 } : undefined} data-sign-in-subheading>
          {settings.subheading}
        </p>
      )}
    </div>
  )
}

/** Panel CSS variables: the link / focus colour for the panel's tone. */
function panelVars(colors: SignInColors, tone: PanelTone): CSSProperties {
  return { '--fsi-ink': tone === 'dark' ? colors.accentOnDark : colors.accentInk } as CSSProperties
}

/** The theme's canvas image (a workspace theme's gradient / texture; none in the UserTasks look). */
const CANVAS: CSSProperties = { backgroundImage: 'var(--theme-canvas-image, none)', backgroundSize: 'var(--theme-canvas-image-size, auto)' }

const CARD = 'fsi-enter w-full rounded-2xl border border-border bg-panel text-fg'

export function FormSignInLayout({ design, settings, colors, logoUrl, workspaceName, form, headings = 'display', preview = false }: SignInLayoutProps) {
  const d = signInDesign(design)
  const root: CSSProperties = {
    '--fsi-accent': colors.accent,
    '--fsi-on-accent': colors.onAccent,
    '--fsi-ink': colors.accentInk,
  } as CSSProperties
  const fill = preview ? 'min-h-full h-full' : 'min-h-screen'
  const common = { 'data-sign-in-design': d.key, 'data-sign-in-design-id': d.id } as Record<string, string | number>
  const brand = (size?: 'sm' | 'md' | 'lg', onColor?: string) => <Brand logoUrl={logoUrl} name={workspaceName} size={size} onColor={onColor} />
  const heading = (props: { tone?: PanelTone; size?: 'sm' | 'md' | 'lg'; center?: boolean; onColor?: string } = {}) => (
    <Heading settings={settings} tone={props.tone ?? 'light'} headings={headings} size={props.size} center={props.center} onColor={props.onColor} />
  )
  /** A logo on a coloured panel sits on a white chip, so any upload stays visible. */
  const logoChip = (onColor: string) => (logoUrl ? <span className="inline-flex rounded-lg bg-white px-2 py-1 shadow-sm">{brand('sm')}</span> : brand('md', onColor))

  switch (d.key) {
    case 'split':
      return (
        <div {...common} className={cn('@container relative w-full bg-bg text-fg', fill)} style={root}>
          <div className={cn('grid w-full @3xl:grid-cols-2', fill)}>
            <section className="relative flex flex-col justify-between gap-8 overflow-hidden p-8 @3xl:p-12" style={{ backgroundColor: colors.accent, color: colors.onAccent }}>
              <span aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 size-80 rounded-full" style={{ backgroundColor: colors.onAccent, opacity: 0.06 }} />
              <div className="relative">{logoChip(colors.onAccent)}</div>
              <div className="relative max-w-md">{heading({ size: 'lg', onColor: colors.onAccent })}</div>
              <div aria-hidden className="relative hidden h-1 w-16 rounded-full @3xl:block" style={{ backgroundColor: colors.onAccent, opacity: 0.6 }} />
            </section>
            <section className="flex items-center justify-center p-8 @3xl:p-12" style={{ ...panelVars(colors, 'light'), ...CANVAS }}>
              <div className="fsi-enter w-full max-w-sm">{form('light')}<Footer settings={settings} tone="light" /></div>
            </section>
          </div>
        </div>
      )
    case 'minimal':
      return (
        <div {...common} className={cn('@container w-full bg-panel text-fg', fill)} style={{ ...root, ...panelVars(colors, 'light') }}>
          <div className="fsi-enter mx-auto flex w-full max-w-sm flex-col gap-8 px-6 py-12 @3xl:py-20">
            <div>{brand('sm')}</div>
            {heading({ size: 'lg' })}
            {form('light')}
            <Footer settings={settings} tone="light" className="mt-0 border-t border-border pt-6" />
          </div>
        </div>
      )
    case 'gradient':
      return (
        <div {...common} className={cn('@container flex w-full items-center justify-center px-4 py-12', fill)}
          style={{ ...root, backgroundImage: `radial-gradient(circle at 15% 10%, ${shade(colors.accent, 0.25)}66 0, transparent 45%), linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDeep} 100%)` }}>
          <div className={cn(CARD, 'max-w-md border-transparent p-8 shadow-2xl @3xl:p-10')} style={panelVars(colors, 'light')}>
            <div className="mb-6 flex justify-center">{brand('md')}</div>
            {heading({ center: true })}
            <div className="mt-7">{form('light')}</div>
            <Footer settings={settings} tone="light" className="text-center" />
          </div>
        </div>
      )
    case 'rail':
      return (
        <div {...common} className={cn('@container w-full bg-bg text-fg', fill)} style={{ ...root, ...CANVAS }}>
          <div className={cn('flex w-full flex-col @3xl:flex-row', fill)}>
            <aside className="flex items-center gap-3 px-6 py-4 @3xl:w-28 @3xl:flex-col @3xl:justify-between @3xl:px-0 @3xl:py-8" style={{ backgroundColor: colors.accent, color: colors.onAccent }}>
              <div className="@3xl:flex @3xl:justify-center">{logoUrl ? <span className="inline-flex rounded-lg bg-white p-1.5">{brand('sm')}</span> : brand('sm', colors.onAccent)}</div>
              <span aria-hidden className="hidden text-xs font-semibold uppercase tracking-[0.3em] @3xl:block" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                {workspaceName ?? ''}
              </span>
            </aside>
            <section className="flex flex-1 items-center px-6 py-12 @3xl:px-16" style={panelVars(colors, 'light')}>
              <div className="fsi-enter w-full max-w-md">
                {heading({ size: 'lg' })}
                <div className="mt-8">{form('light')}</div>
                <Footer settings={settings} tone="light" />
              </div>
            </section>
          </div>
        </div>
      )
    case 'glass':
      return (
        <div {...common} className={cn('@container relative flex w-full items-center justify-center overflow-hidden px-4 py-12', fill)}
          style={{
            ...root,
            backgroundColor: colors.accentDeep,
            backgroundImage: `radial-gradient(circle at 20% 20%, ${colors.accent}cc 0, transparent 45%), radial-gradient(circle at 80% 75%, ${shade(colors.accent, 0.35)}aa 0, transparent 40%), radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)`,
            backgroundSize: 'auto, auto, 22px 22px',
          }}>
          <div className={cn(CARD, 'relative max-w-md rounded-3xl border-white/40 p-8 shadow-2xl backdrop-blur-xl @3xl:p-10')}
            style={{ ...panelVars(colors, 'light'), backgroundColor: 'color-mix(in srgb, var(--theme-card-bg) 86%, transparent)' }}>
            <div className="mb-6">{brand('md')}</div>
            {heading()}
            <div className="mt-6">{form('light')}</div>
            <Footer settings={settings} tone="light" />
          </div>
        </div>
      )
    case 'banner':
      return (
        <div {...common} className={cn('@container w-full bg-bg text-fg', fill)} style={{ ...root, ...CANVAS }}>
          <header className="px-6 pb-28 pt-8 @3xl:px-12" style={{ backgroundColor: colors.accent, color: colors.onAccent }}>
            <div className="mx-auto max-w-md">
              {logoChip(colors.onAccent)}
              <h1 className={cn('mt-6 text-2xl font-semibold tracking-tight text-balance @3xl:text-3xl', headings === 'display' ? 'font-display' : 'font-sans')} data-sign-in-heading>{settings.heading}</h1>
            </div>
          </header>
          <div className="-mt-20 px-4 pb-12">
            <div className={cn(CARD, 'mx-auto max-w-md p-8 shadow-xl')} style={panelVars(colors, 'light')}>
              {settings.subheading && <p className="mb-6 text-sm leading-relaxed text-fg-muted" data-sign-in-subheading>{settings.subheading}</p>}
              {form('light')}
              <Footer settings={settings} tone="light" />
            </div>
          </div>
        </div>
      )
    case 'dark':
      return (
        <div {...common} className={cn('@container flex w-full items-center justify-center px-4 py-12 text-zinc-50', fill)}
          style={{ ...root, backgroundColor: '#0b0f19', backgroundImage: `radial-gradient(ellipse 60% 45% at 50% 0%, ${colors.accent}55 0, transparent 70%)` }}>
          <div className="fsi-enter w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl backdrop-blur @3xl:p-10" style={panelVars(colors, 'dark')}>
            <div className="mb-8 flex justify-center">{logoUrl ? <span className="inline-flex rounded-lg bg-white px-2 py-1">{brand('sm')}</span> : brand('md', '#fafafa')}</div>
            {heading({ tone: 'dark', center: true })}
            <div className="mt-8">{form('dark')}</div>
            <Footer settings={settings} tone="dark" className="text-center" />
          </div>
        </div>
      )
    case 'soft':
      return (
        <div {...common} className={cn('@container relative flex w-full items-center justify-center overflow-hidden px-4 py-12', fill)}
          style={{ ...root, backgroundColor: shade(colors.accent, 0.92) }}>
          <span aria-hidden className="pointer-events-none absolute -left-16 -top-16 size-72 rounded-full blur-2xl" style={{ backgroundColor: shade(colors.accent, 0.6), opacity: 0.55 }} />
          <span aria-hidden className="pointer-events-none absolute -bottom-20 -right-10 size-80 rounded-[40%] blur-2xl" style={{ backgroundColor: shade(colors.accent, 0.45), opacity: 0.45 }} />
          <span aria-hidden className="pointer-events-none absolute right-1/4 top-10 size-16 rotate-12 rounded-2xl" style={{ backgroundColor: shade(colors.accent, 0.3), opacity: 0.35 }} />
          <div className={cn(CARD, 'relative max-w-md rounded-[2rem] border-transparent p-8 shadow-xl @3xl:p-10')} style={panelVars(colors, 'light')}>
            <div className="mb-6 flex justify-center">{brand('md')}</div>
            {heading({ center: true })}
            <div className="mt-6">{form('light')}</div>
            <Footer settings={settings} tone="light" className="text-center" />
          </div>
        </div>
      )
    case 'compact':
      return (
        <div {...common} className={cn('@container w-full p-2', preview ? 'min-h-full h-full bg-bg' : '')} style={root}>
          <div className="mx-auto w-full max-w-sm rounded-xl border border-border bg-panel p-5 text-fg shadow-sm" style={panelVars(colors, 'light')}>
            <div className="mb-4 flex items-center gap-3">{brand('sm')}</div>
            {heading({ size: 'sm' })}
            <div className="mt-4">{form('light')}</div>
            <Footer settings={settings} tone="light" className="mt-4" />
          </div>
        </div>
      )
    case 'centered':
    default:
      return (
        <div {...common} className={cn('@container relative w-full bg-bg text-fg', fill)} style={{ ...root, ...CANVAS }}>
          <div className={cn('grid w-full @4xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]', fill)}>
            <section className="relative flex flex-col gap-8 overflow-hidden border-b border-border-subtle bg-panel px-6 py-8 @3xl:px-10 @4xl:justify-between @4xl:border-b-0 @4xl:border-r @4xl:p-12" data-sign-in-brand-panel>
              <span aria-hidden className="pointer-events-none absolute -right-28 -top-28 size-96 rounded-full blur-3xl" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-accent, #b08a54) 14%, transparent)' }} />
              <span aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 size-80 rounded-full blur-3xl" style={{ backgroundColor: 'color-mix(in srgb, var(--fsi-accent) 7%, transparent)' }} />
              <div className="relative">{logoUrl ? brand('md') : <UserTasksBrand />}</div>
              <div className="relative max-w-md">
                {heading({ size: 'lg' })}
                {workspaceName && (
                  <p className="mt-6 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-bg px-3 py-1 text-xs font-medium text-fg-muted" data-sign-in-workspace>
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--fsi-accent)' }} />
                    <span className="truncate">{workspaceName}</span>
                  </p>
                )}
              </div>
              <div aria-hidden className="relative hidden h-px w-16 bg-border-strong @4xl:block" />
            </section>
            <section className="flex items-center justify-center px-6 py-10 @4xl:p-12" style={panelVars(colors, 'light')}>
              <div className="fsi-enter w-full max-w-sm">
                {form('light')}
                <Footer settings={settings} tone="light" />
              </div>
            </section>
          </div>
        </div>
      )
  }
}
