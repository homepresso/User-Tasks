'use client'

import { useEffect, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsSaveBar } from './settings-section'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { serverRead } from '@/lib/server-read'
import { setAnonymousWorkspaceSettings } from '@/app/actions/anonymous-forms'
import type { AnonymousWorkspaceView, CaptchaProvider } from '@/lib/forms/anonymous'

/**
 * Settings → Forms → Anonymous forms (settings.edit): the workspace switch
 * that lets form designers turn on public links, and the optional bot
 * protection (Cloudflare Turnstile or hCaptcha; the secret is write-only and
 * stored encrypted). Off stops every public link of the workspace at once.
 */


export function AnonymousFormsCard({ readOnly }: { readOnly: boolean }) {
  const [settings, setSettings] = useState<AnonymousWorkspaceView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [provider, setProvider] = useState<CaptchaProvider | ''>('')
  const [siteKey, setSiteKey] = useState('')
  const [secret, setSecret] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const guard = useSubmitGuard()

  function load(value: AnonymousWorkspaceView) {
    setSettings(value)
    setEnabled(value.enabled)
    setProvider(value.captcha.provider ?? '')
    setSiteKey(value.captcha.site_key ?? '')
    setSecret('')
  }

  useEffect(() => {
    let active = true
    serverRead('forms.anonymousWorkspace').then(({ data }) => { if (active && data) load(data) })
    return () => { active = false }
  }, [])

  if (!settings) return <p className="text-sm text-fg-muted">Loading…</p>

  const captchaChanged = (provider || null) !== settings.captcha.provider || (provider && siteKey !== (settings.captcha.site_key ?? '')) || Boolean(secret)
  const dirty = enabled !== settings.enabled || Boolean(captchaChanged)

  function save(e: React.FormEvent) {
    e.preventDefault()
    void guard.run(async () => {
      setNotice(null)
      const result = await setAnonymousWorkspaceSettings({
        enabled,
        ...(captchaChanged ? { captcha: provider ? { provider, site_key: siteKey, ...(secret ? { secret } : {}) } : null } : {}),
      })
      if (!result.ok) { setNotice({ tone: 'error', message: result.error }); return }
      load(result.data)
      setNotice({ tone: 'success', message: 'Saved.' })
    })
  }

  return (
    <form onSubmit={save} className="space-y-4" aria-label="Anonymous forms" data-testid="anonymous-forms-card">
      <Checkbox
        checked={enabled}
        disabled={readOnly}
        onChange={(e) => setEnabled(e.target.checked)}
        data-testid="anonymous-forms-enabled"
        label={<span className="font-medium">Allow anonymous forms</span>}
        description={<>Form designers (forms.edit) can give a form a public link that people fill in without signing in. Each form still needs its own &ldquo;Allow anonymous responses&rdquo;. Turning this off stops every public link in this workspace immediately.</>}
      />
      <fieldset disabled={readOnly} className="space-y-4 border-t border-border-subtle pt-4">
        <legend className="sr-only">Bot protection</legend>
        <div>
          <p className="text-ui font-medium text-fg">Bot protection <span className="font-normal text-fg-muted">Optional</span></p>
          <p className="mt-0.5 text-xs text-fg-muted">
            Without it, public forms rely on rate limits, a hidden honeypot field and a minimum fill time. With it, visitors also solve a challenge, which is checked on the server.
            Nothing is sent to the provider unless you set it up here.
          </p>
        </div>
        <Field label="Provider">
          <Select value={provider} onChange={(e) => setProvider(e.target.value as CaptchaProvider | '')} data-testid="anonymous-captcha-provider" wrapperClassName="max-w-xs">
            <option value="">None</option>
            <option value="turnstile">Cloudflare Turnstile</option>
            <option value="hcaptcha">hCaptcha</option>
          </Select>
        </Field>
        {provider && (
          <>
            <Field label="Site key">
              <Input value={siteKey} onChange={(e) => setSiteKey(e.target.value)} autoComplete="off" className="font-mono" />
            </Field>
            <Field label="Secret key" description="Stored encrypted; never shown again.">
              <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={settings.captcha.has_secret && settings.captcha.provider === provider ? 'Saved — leave empty to keep it' : ''} autoComplete="new-password" />
            </Field>
          </>
        )}
      </fieldset>
      {notice?.tone === 'success' && <p role="status" className="text-xs text-success">{notice.message}</p>}
      {!readOnly && (
        <SettingsSaveBar
          dirty={dirty}
          saving={guard.pending}
          error={notice?.tone === 'error' ? notice.message : null}
          onDiscard={() => { load(settings); setNotice(null) }}
          saveLabel="Save anonymous forms"
          saveTestId="anonymous-forms-save"
        />
      )}
    </form>
  )
}
