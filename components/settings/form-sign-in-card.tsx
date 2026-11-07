'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Monitor, RotateCcw, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { serverRead } from '@/lib/server-read'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { cn } from '@/lib/utils'
import { setFormSignInSettingsAction } from '@/app/actions/form-sign-in'
import {
  DEFAULT_SIGN_IN_SETTINGS, PLATFORM_ACCENT, SIGN_IN_DESIGNS, SIGN_IN_LIMITS, formSignInInputProblem, signInColors,
  type FormSignInSettings,
} from '@/lib/forms/sign-in-page'
import { signInThemeStyle } from '@/lib/forms/sign-in-theme'
import { FormSignInScreen } from '@/components/forms/sign-in/form-sign-in-screen'
import { DesignThumbnail } from '@/components/forms/sign-in/design-thumbnails'
import { FormLoading } from '@/components/forms/form-loading'
import { LogoUpload } from './logo-upload'
import { SettingsSaveBar } from './settings-section'

/**
 * Settings → Forms → Form sign-in page (settings.edit to change; anyone in
 * Settings sees it): what visitors see when a form link needs them to sign
 * in (/form-login). Logo, one of ten designs, the wording, an optional
 * support link and the look — the UserTasks colours with an optional accent
 * colour, or the workspace theme — with a live desktop / mobile preview. Stored in
 * tenants.settings.forms.sign_in (lib/services/form-sign-in-page.ts).
 */

const PREVIEW_OPTIONS = { provider: 'builtin' as const, password: true, sso: [] }

function same(a: FormSignInSettings, b: FormSignInSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function FormSignInCard({ tenantId, readOnly }: { tenantId: string; readOnly: boolean }) {
  const { theme } = useWorkspaceTheme()
  const [saved, setSaved] = useState<FormSignInSettings | null>(null)
  const [draft, setDraft] = useState<FormSignInSettings>(DEFAULT_SIGN_IN_SETTINGS)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [logoKey, setLogoKey] = useState(0)
  const guard = useSubmitGuard()

  useEffect(() => {
    let active = true
    serverRead('forms.signInPage').then(({ data }) => {
      if (!active || !data) return
      setSaved(data as FormSignInSettings)
      setDraft(data as FormSignInSettings)
    })
    return () => { active = false }
  }, [])

  if (!saved) return <FormLoading compact label="Loading the sign-in page" />

  const set = <K extends keyof FormSignInSettings>(key: K, value: FormSignInSettings[K]) => { setDraft((d) => ({ ...d, [key]: value })); setNotice(null) }
  const dirty = !same(draft, saved)
  const problem = formSignInInputProblem({ ...draft, support_link_url: draft.support_link_url ?? '', accent_color: draft.accent_color ?? '', logo_url: draft.logo_url ?? '' })
  // The preview's look: the same tokens the public page gets (lib/forms/sign-in-theme.ts).
  const themeStyle = signInThemeStyle(draft, theme)
  const colors = signInColors(themeStyle.accent)

  function save() {
    if (problem) { setNotice({ tone: 'error', message: problem }); return }
    void guard.run(async () => {
      setNotice(null)
      const result = await setFormSignInSettingsAction({ ...draft, logo_url: draft.logo_url ?? '', support_link_url: draft.support_link_url ?? '', accent_color: draft.accent_color ?? '' })
      if (!result.ok) { setNotice({ tone: 'error', message: result.error }); return }
      setSaved(result.data)
      setDraft(result.data)
      setNotice({ tone: 'success', message: 'Saved.' })
    })
  }

  const counter = (key: keyof typeof SIGN_IN_LIMITS, value: string) => (
    <span className={cn('text-2xs tabular-nums', value.length > SIGN_IN_LIMITS[key] ? 'text-danger' : 'text-fg-muted')}>{value.length}/{SIGN_IN_LIMITS[key]}</span>
  )

  return (
    <div className="space-y-6" data-testid="form-sign-in-card">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <fieldset disabled={readOnly} className="min-w-0 space-y-5">
          <legend className="sr-only">Form sign-in page</legend>

          <div>
            <p className="mb-2 text-ui font-medium text-fg" id="fsi-design-label">Design</p>
            <div role="radiogroup" aria-labelledby="fsi-design-label" className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-2" data-sign-in-designs>
              {SIGN_IN_DESIGNS.map((d) => {
                const selected = draft.design === d.id
                return (
                  <button key={d.id} type="button" role="radio" aria-checked={selected} onClick={() => set('design', d.id)}
                    title={d.description} data-sign-in-design-option={d.id}
                    className={cn('group flex flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      selected ? 'border-primary bg-primary-wash' : 'border-border hover:border-border-strong')}>
                    <span className="block aspect-[4/3] w-full overflow-hidden rounded-md border border-border-subtle" aria-hidden>
                      <DesignThumbnail design={d.id} colors={colors} />
                    </span>
                    <span className="truncate px-0.5 text-2xs font-medium text-fg">{d.id}. {d.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-ui font-medium text-fg">Logo</p>
            <LogoUpload key={logoKey} tenantId={tenantId} currentLogoUrl={draft.logo_url} readOnly={readOnly} variant="form-sign-in"
              onChange={(url) => set('logo_url', url)} />
          </div>

          <Field label="Heading" labelAside={counter('heading', draft.heading)}>
            <Input value={draft.heading} onChange={(e) => set('heading', e.target.value)} maxLength={SIGN_IN_LIMITS.heading + 20} data-testid="sign-in-heading" />
          </Field>
          <Field label="Welcome message" optional labelAside={counter('subheading', draft.subheading)}>
            <Textarea rows={2} value={draft.subheading} onChange={(e) => set('subheading', e.target.value)} />
          </Field>
          <Field label="Button label" labelAside={counter('button_label', draft.button_label)}>
            <Input value={draft.button_label} onChange={(e) => set('button_label', e.target.value)} />
          </Field>
          <Field label="Footer text" optional description="Small print under the form, e.g. who to contact." labelAside={counter('footer_text', draft.footer_text)}>
            <Textarea rows={2} value={draft.footer_text} onChange={(e) => set('footer_text', e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Support link label" optional>
              <Input value={draft.support_link_label} onChange={(e) => set('support_link_label', e.target.value)} placeholder="Get help" />
            </Field>
            <Field label="Support link" optional description="https:// or mailto:">
              <Input value={draft.support_link_url ?? ''} onChange={(e) => set('support_link_url', e.target.value || null)} placeholder="https://help.example.com" inputMode="url" />
            </Field>
          </div>
          <div className="space-y-1.5 rounded-lg border border-border p-3" data-sign-in-theme-option>
            <Switch checked={draft.use_workspace_theme} onCheckedChange={(on) => set('use_workspace_theme', on)} label="Use the workspace theme" data-testid="sign-in-use-theme" />
            <p className="text-2xs text-fg-muted">
              {draft.use_workspace_theme
                ? 'The page takes the workspace theme’s colours, fonts, corners, light / dark mode and background. The design, logo and wording still apply.'
                : 'Off: the UserTasks look (warm neutrals, ink buttons, the UserTasks logo until you upload one), with your accent colour if set.'}
            </p>
          </div>
          <Field label="Accent colour"
            description={draft.use_workspace_theme ? 'Not used while the page follows the workspace theme (its primary colour is used).' : draft.accent_color ? 'Buttons and coloured panels. Text on it is chosen to stay readable.' : 'The UserTasks default (ink).'}>
            <div className={cn('flex items-center gap-2', draft.use_workspace_theme && 'opacity-50')} data-sign-in-accent>
              <input type="color" aria-label="Accent colour" value={colors.accent} disabled={draft.use_workspace_theme} onChange={(e) => set('accent_color', e.target.value.toLowerCase())}
                className="h-9 w-12 cursor-pointer rounded-md border border-border bg-input p-1 disabled:cursor-not-allowed" />
              <Input value={draft.accent_color ?? ''} placeholder={PLATFORM_ACCENT} disabled={draft.use_workspace_theme} onChange={(e) => set('accent_color', e.target.value.trim() || null)} className="max-w-32 font-mono" aria-label="Accent colour hex" />
              {draft.accent_color && !draft.use_workspace_theme && <Button type="button" size="sm" variant="ghost" onClick={() => set('accent_color', null)}>Use the default</Button>}
            </div>
          </Field>
          {!readOnly && (
            <Button type="button" size="sm" variant="secondary" leadingIcon={<RotateCcw />} data-testid="sign-in-reset"
              onClick={() => { setDraft({ ...DEFAULT_SIGN_IN_SETTINGS }); setLogoKey((k) => k + 1); setNotice(null) }}>
              Reset to defaults
            </Button>
          )}
        </fieldset>

        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-ui font-medium text-fg">Preview</p>
            <SegmentedControl aria-label="Preview size" size="sm" value={device} onValueChange={setDevice}
              options={[{ value: 'desktop', icon: <Monitor className="size-4" />, label: 'Desktop' }, { value: 'mobile', icon: <Smartphone className="size-4" />, label: 'Mobile' }]} />
          </div>
          <ScaledPreview device={device}>
            <FormSignInScreen preview settings={draft} logoUrl={draft.logo_url ? resolveStorageUrl(draft.logo_url) : null}
              workspace={{ name: 'Your workspace', slug: 'your-workspace' }} themeStyle={themeStyle} options={PREVIEW_OPTIONS}
              returnPath="/f/preview" ssoStart={null} openUrl="#" embed={false} />
          </ScaledPreview>
          <p className="text-2xs text-fg-muted">Shown when a form link (<code>/f/…</code> or <code>/form/…</code>) needs someone to sign in. Embedded in another website, the page uses the Compact design with &ldquo;Open the form in a new tab&rdquo;.</p>
        </div>
      </div>

      {notice?.tone === 'success' && <p role="status" className="text-xs text-success">{notice.message}</p>}
      {!readOnly && (
        <SettingsSaveBar dirty={dirty} saving={guard.pending} error={notice?.tone === 'error' ? notice.message : null}
          onDiscard={() => { setDraft(saved); setLogoKey((k) => k + 1); setNotice(null) }} onSave={save}
          saveLabel="Save sign-in page" saveTestId="sign-in-save" />
      )}
    </div>
  )
}

const SIZES = { desktop: { width: 1200, height: 780 }, mobile: { width: 390, height: 780 } } as const

/** The page drawn at a real device width and scaled to fit the column (container queries pick the layout). */
function ScaledPreview({ device, children }: { device: 'desktop' | 'mobile'; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const size = SIZES[device]
  const scale = width ? Math.min(1, (device === 'mobile' ? Math.min(width, 320) : width) / size.width) : 0.5
  return (
    <div ref={ref} className="w-full" data-sign-in-preview={device}>
      <div className="mx-auto overflow-hidden rounded-lg border border-border bg-subtle shadow-elev-1"
        style={{ width: size.width * scale, height: size.height * scale }}>
        <div inert style={{ width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: 'top left', overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
