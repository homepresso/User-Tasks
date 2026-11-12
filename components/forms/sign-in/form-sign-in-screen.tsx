'use client'

import { useState } from 'react'
import { ExternalLink, KeyRound } from 'lucide-react'
import { signInAction, startSsoAction } from '@/app/actions/auth'
import { signInColors, type FormSignInSettings } from '@/lib/forms/sign-in-page'
import type { SignInThemeStyle } from '@/lib/forms/sign-in-theme'
import { Spinner } from '@/components/ui/spinner'
import type { LoginOptions, SsoOption } from '@/lib/providers/auth/types'
import { cn } from '@/lib/utils'
import { FormSignInLayout, type PanelTone } from './form-sign-in-layout'
import { EmbedFrame } from '../embed-frame'
import { FontLinks } from '@/components/fonts/font-links'

/**
 * The form sign-in page (/form-login), and its preview in Settings → Forms.
 * Same sign-in methods as the app's /login — password (organisation, email,
 * password) and the configured SSO buttons — through the same server
 * actions (app/actions/auth.ts): no new auth logic. After signing in the
 * visitor goes back to the form (a same-host /f/ or /form/ path, sanitised
 * on the server and again by signInAction).
 *
 * Embedded in another site the page can't sign anyone in (browsers don't
 * keep session cookies for third-party frames), so it shows the compact
 * design with "Open the form in a new tab".
 *
 * The look (lib/forms/sign-in-theme.ts) arrives as a scoped stylesheet of
 * design tokens: the UserTasks palette, or the workspace theme when the
 * page uses it. Inputs, buttons and focus rings match the cloud /login.
 */
export interface FormSignInScreenProps {
  settings: FormSignInSettings
  /** The logo's URL, resolved for the browser. */
  logoUrl: string | null
  workspace: { name: string; slug: string } | null
  /** The tokens and accent (signInThemeStyle on the server, or in the settings card). */
  themeStyle: SignInThemeStyle
  options: LoginOptions
  /** Where to go after signing in (a sanitised form path). */
  returnPath: string
  /**
   * SSO on a workspace address with shared sessions starts on the main
   * address (where the SSO callbacks are): `${base}/auth/sso/<id>/start?…`
   * with the /ws/ hop back. Null: start it here (startSsoAction).
   */
  ssoStart: { base: string; redirect: string } | null
  /** The form's own URL (Open in a new tab, when embedded). */
  openUrl: string
  embed: boolean
  error?: string | null
  /** The settings preview: nothing is submitted. */
  preview?: boolean
}

export function FormSignInScreen(props: FormSignInScreenProps) {
  const { settings, logoUrl, workspace, themeStyle, embed, preview } = props
  const colors = signInColors(themeStyle.accent)
  const design = embed ? 10 : settings.design
  return (
    <EmbedFrame embed={embed && !preview}>
      <FontLinks hrefs={themeStyle.fontHrefs} />
      <style dangerouslySetInnerHTML={{ __html: themeStyle.css }} />
      <div data-fsi-root data-ds-scope data-sign-in-theme={themeStyle.source} className={cn('font-sans antialiased', preview && 'h-full')}>
        <FormSignInLayout
          design={design}
          settings={settings}
          colors={colors}
          logoUrl={logoUrl}
          workspaceName={workspace?.name ?? null}
          headings={themeStyle.headings}
          preview={preview}
          form={(tone) => (embed ? <OpenInNewTab url={props.openUrl} tone={tone} preview={preview} /> : <SignInForm {...props} tone={tone} />)}
        />
      </div>
    </EmbedFrame>
  )
}

const BUTTON = 'inline-flex h-11 w-full select-none items-center justify-center gap-2 rounded-[var(--theme-button-radius,8px)] px-4 text-sm font-semibold shadow-elev-1 transition-[filter,opacity,box-shadow] duration-150 hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2'

function OpenInNewTab({ url, tone, preview }: { url: string; tone: PanelTone; preview?: boolean }) {
  return (
    <div className="space-y-3" data-sign-in-embedded>
      <p className={cn('text-sm leading-relaxed', tone === 'dark' ? 'text-zinc-300' : 'text-fg-muted')}>
        Your browser can&apos;t sign you in inside another website. Open the form in a new tab to sign in and fill it in there.
      </p>
      <a href={preview ? undefined : url} target="_blank" rel="noopener" className={BUTTON}
        style={{ backgroundColor: 'var(--fsi-accent)', color: 'var(--fsi-on-accent)', outlineColor: 'var(--fsi-ink)' }} data-sign-in-open-tab>
        Open the form in a new tab <ExternalLink className="size-4" aria-hidden />
      </a>
    </div>
  )
}

function SignInForm({ settings, workspace, options, returnPath, ssoStart, error: initialError, preview, tone }: FormSignInScreenProps & { tone: PanelTone }) {
  const [org, setOrg] = useState(workspace?.slug ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [busy, setBusy] = useState(false)
  const dark = tone === 'dark'
  const knownOrg = Boolean(workspace?.slug)
  // Inputs as on the cloud /login: 44px, the theme's input radius, a soft focus ring in the accent.
  const input = cn('h-11 w-full rounded-[var(--theme-input-radius,8px)] border px-3 text-sm shadow-xs outline-none transition-[border-color,box-shadow] duration-150',
    'focus-visible:border-[var(--fsi-ink)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--fsi-ink)_22%,transparent)]',
    dark ? 'border-zinc-700 bg-zinc-950 text-zinc-50 placeholder:text-zinc-500' : 'border-border-strong bg-panel text-fg placeholder:text-fg-subtle hover:border-[color-mix(in_srgb,var(--fsi-ink)_45%,var(--ds-border-strong))]')
  const label = cn('mb-1.5 block text-sm font-medium', dark ? 'text-zinc-200' : 'text-fg')
  const focus = { outlineColor: 'var(--fsi-ink)' }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (preview) return
    setError(null)
    if (!org.trim()) { setError('Organisation is required.'); return }
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    setBusy(true)
    const result = await signInAction({ org: org.trim().toLowerCase(), email, password, redirect: returnPath })
    if (!result.ok) { setError(result.error); setBusy(false); return }
    window.location.assign(result.redirect)
  }

  async function sso(option: SsoOption) {
    if (preview) return
    setError(null)
    const orgSlug = org.trim().toLowerCase()
    if (options.provider === 'supabase' && !orgSlug) { setError('Enter your organisation name first.'); return }
    if (ssoStart) {
      const q = new URLSearchParams({ redirect: ssoStart.redirect })
      if (orgSlug) q.set('org', orgSlug)
      window.location.assign(`${ssoStart.base}/auth/sso/${encodeURIComponent(option.id)}/start?${q.toString()}`)
      return
    }
    const result = await startSsoAction({ provider: option.id, org: orgSlug || null, redirect: returnPath })
    if (!result.ok) { setError(result.error); return }
    window.location.assign(result.url)
  }

  const orgField = !knownOrg && (
    <div>
      <label htmlFor="fsi-org" className={label}>Organisation</label>
      <input id="fsi-org" className={input} style={focus} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="your-organisation" autoComplete="organization" required={options.password} />
    </div>
  )

  return (
    <div data-sign-in-form>
      {error && (
        <p role="alert" className={cn('mb-4 rounded-lg border px-3 py-2 text-sm', dark ? 'border-red-900 bg-red-950 text-red-200' : 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-danger-wash text-danger')}>{error}</p>
      )}
      {options.password ? (
        <form onSubmit={submit} className="space-y-4" aria-label="Sign in">
          {orgField}
          <div>
            <label htmlFor="fsi-email" className={label}>Email address</label>
            <input id="fsi-email" type="email" className={input} style={focus} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="fsi-password" className={cn(label, 'mb-0')}>Password</label>
              <a href={preview ? undefined : '/forgot-password'} className="text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: 'var(--fsi-ink)', ...focus }}>Forgot password?</a>
            </div>
            <input id="fsi-password" type="password" className={input} style={focus} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
          </div>
          <button type="submit" disabled={busy} aria-busy={busy} className={cn(BUTTON, 'mt-2')}
            style={{ backgroundColor: 'var(--fsi-accent)', color: 'var(--fsi-on-accent)', outlineColor: 'var(--fsi-ink)' }} data-sign-in-submit>
            {busy ? <><Spinner size="sm" decorative /> Signing in…</> : settings.button_label}
          </button>
        </form>
      ) : orgField}
      {options.sso.length > 0 && (
        <>
          {options.password && (
            <div className="my-5 flex items-center gap-3" aria-hidden>
              <span className={cn('h-px flex-1', dark ? 'bg-zinc-800' : 'bg-border-subtle')} />
              <span className={cn('text-xs', dark ? 'text-zinc-400' : 'text-fg-muted')}>or continue with</span>
              <span className={cn('h-px flex-1', dark ? 'bg-zinc-800' : 'bg-border-subtle')} />
            </div>
          )}
          <div className={cn('space-y-2', !options.password && 'mt-4')}>
            {options.sso.map((option) => (
              <button key={option.id} type="button" onClick={() => void sso(option)}
                className={cn(BUTTON, 'border font-medium shadow-none hover:brightness-100', dark ? 'border-zinc-700 bg-zinc-950 text-zinc-50 hover:bg-zinc-900' : 'border-border bg-panel text-fg hover:border-border-strong hover:bg-subtle')}
                style={focus} data-sign-in-sso={option.id}>
                <KeyRound className="size-4" aria-hidden /> Continue with {option.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
