'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Globe2, Link2, RefreshCw } from 'lucide-react'
import { serverRead } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { setFormAnonymousAccess, regenerateFormAnonymousToken } from '@/app/actions/anonymous-forms'
import { ANONYMOUS_LIMITS, type AnonymousFormSettings } from '@/lib/forms/anonymous'
import { publicAppOrigin } from '@/lib/forms/form-page-url'
import type { FormAnonymousAccess } from '@/lib/services/anonymous-forms'
import { FormQrButton } from './form-qr-dialog'

/**
 * A form's "Allow anonymous responses" (Form details): the public link
 * (/p/<token>, copy / QR / regenerate), the visitor limits and — before and
 * while it is on — what anonymous visitors can and can't do with THIS form
 * (lib/forms/anonymous.ts anonymousReadiness). Changing it needs forms.edit
 * and the workspace's "Allow anonymous forms" (Settings → Forms).
 */


export function anonymousLinkUrl(path: string): string {
  const origin = publicAppOrigin() || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${origin}${path}`
}

function NumberSetting({ label, value, range, suffix, onChange, disabled, testId }: { label: string; value: number; range: { min: number; max: number }; suffix?: string; onChange: (n: number) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className="block text-xs">
      <span className="font-medium">{label}</span>
      <span className="mt-1 flex items-center gap-1">
        <input type="number" min={range.min} max={range.max} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 w-24 rounded-md border px-2 text-sm border-border bg-input text-fg" data-testid={testId} />
        {suffix && <span className="text-fg-muted">{suffix}</span>}
      </span>
    </label>
  )
}

export function FormAnonymousSection({ formId, formName }: { formId: string; formName: string }) {
  const { can } = usePermissions()
  const canEdit = can('forms.edit')
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [draft, setDraft] = useState<AnonymousFormSettings | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const { data: access } = useQuery({
    queryKey: ['form-anonymous', formId],
    queryFn: async () => {
      const { data, error } = await serverRead('forms.anonymous', { id: formId })
      if (error) throw new Error(error.message)
      return data as FormAnonymousAccess
    },
  })
  if (!access) return null
  const settings = draft ?? access.settings
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(access.settings)
  const url = access.path ? anonymousLinkUrl(access.path) : null

  async function apply(input: Parameters<typeof setFormAnonymousAccess>[1], done: string) {
    setBusy(true); setNotice(null)
    const result = await setFormAnonymousAccess(formId, input)
    setBusy(false)
    if (!result.ok) { setNotice({ tone: 'error', message: result.error }); return }
    queryClient.setQueryData(['form-anonymous', formId], result.data)
    setDraft(null); setConfirming(false)
    setNotice({ tone: 'success', message: done })
  }

  async function rotate() {
    setBusy(true); setNotice(null)
    const result = await regenerateFormAnonymousToken(formId)
    setBusy(false); setConfirmRotate(false)
    if (!result.ok) { setNotice({ tone: 'error', message: result.error }); return }
    queryClient.setQueryData(['form-anonymous', formId], result.data)
    setNotice({ tone: 'success', message: 'New link made: the old link no longer works' })
  }

  return (
    <section className="mt-4 space-y-3 border-t pt-4 border-border" aria-label="Anonymous responses" data-testid="form-anonymous">
      <div className="flex items-center gap-2">
        <Globe2 className="text-primary-text" size={15} aria-hidden />
        <h3 className="text-sm font-semibold">Anonymous responses</h3>
        <span className="rounded-full border px-1.5 text-2xs border-border text-fg-muted" data-anonymous-state={access.live ? 'live' : access.enabled ? 'blocked' : 'off'}>
          {access.live ? 'Public link on' : access.enabled ? 'On, but blocked' : 'Off'}
        </span>
      </div>

      {!access.workspace_enabled && (
        <p className="text-xs text-fg-muted" data-testid="anonymous-workspace-off">
          Anonymous forms are turned off for this workspace. An admin can allow them in Settings → Forms{access.enabled ? ' — until then this form’s public link doesn’t work.' : '.'}
        </p>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={access.enabled || confirming} disabled={!canEdit || busy || (!access.enabled && !access.workspace_enabled)}
          onChange={(e) => { if (e.target.checked) setConfirming(true); else if (confirming) setConfirming(false); else void apply({ enabled: false }, 'Anonymous responses are off: the public link stopped working') }}
          className="mt-1 accent-primary" data-testid="anonymous-enabled" />
        <span>
          <span className="font-medium">Allow anonymous responses</span>
          <span className="block text-xs text-fg-muted">Anyone with the public link can fill in and submit {formName} without signing in.</span>
        </span>
      </label>

      {(confirming || access.enabled) && (
        <div className="space-y-2 rounded-md border p-3 text-xs border-danger" role={confirming ? 'alertdialog' : undefined} aria-label="What anonymous visitors can do" data-testid="anonymous-warnings">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="text-danger" size={13} aria-hidden /> What anonymous visitors can and can&apos;t do</p>
          <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
            <li>They can open this form and submit it — nothing else in your workspace. Submissions are marked Anonymous and start the &ldquo;Form submitted&rdquo; workflows as usual.</li>
            <li>Lookups, Data tables and API sources show nothing to them unless you turn on &ldquo;Allow anonymous read&rdquo; on that field — then anyone with the link can read its declared columns.</li>
            <li>Rule and button steps that call APIs, change tables or start workflows are skipped unless you tick &ldquo;Allow for anonymous&rdquo; on the step.</li>
            <li>Uploads are off unless allowed below; custom controls run without their lookup, files, reports or network capabilities; {'{{user.*}}'} is empty.</li>
            <li>Anyone who has the link can share it. Regenerate the link to revoke it.</li>
          </ul>
          {access.warnings.length > 0 && (
            <>
              <p className="pt-1 font-medium">This form:</p>
              <ul className="list-disc space-y-0.5 pl-4" data-testid="anonymous-form-warnings">
                {access.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </>
          )}
          {confirming && !access.enabled && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled={busy} onClick={() => void apply({ enabled: true }, 'Anonymous responses are on: share the public link')} data-testid="anonymous-confirm">Turn on</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          )}
        </div>
      )}

      {access.enabled && url && (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <input readOnly value={url} className="h-8 flex-1 truncate rounded-md border px-2 font-mono text-2xs border-border bg-input text-fg" aria-label="Public link" data-testid="anonymous-link" onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="ghost" title="Copy the public link" aria-label="Copy the public link" onClick={async () => {
              try { await navigator.clipboard.writeText(url); setNotice({ tone: 'success', message: 'Public link copied' }) } catch { setNotice({ tone: 'error', message: 'Could not copy the link' }) }
            }}><Link2 size={12} /></Button>
            <FormQrButton formId={formId} anonymous />
            {canEdit && <Button size="sm" variant="ghost" title="Regenerate the link (the old one stops working)" aria-label="Regenerate the public link" onClick={() => setConfirmRotate(true)} data-testid="anonymous-regenerate"><RefreshCw size={12} /></Button>}
          </div>
          {confirmRotate && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs border-border" role="alertdialog" aria-label="Regenerate the link?">
              <span className="flex-1">Make a new link? The current link stops working for everyone at once.</span>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void rotate()} data-testid="anonymous-regenerate-confirm">Regenerate</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)}>Keep it</Button>
            </div>
          )}
        </div>
      )}

      {access.enabled && (
        <fieldset disabled={!canEdit || busy} className="space-y-2" aria-label="Anonymous limits">
          <div className="flex flex-wrap gap-4">
            <NumberSetting label="Per visitor (IP)" suffix="/ minute" value={settings.per_ip_per_minute} range={ANONYMOUS_LIMITS.perIpPerMinute} onChange={(n) => setDraft({ ...settings, per_ip_per_minute: n })} testId="anonymous-per-ip" />
            <NumberSetting label="Daily cap" suffix="/ 24 h" value={settings.daily_cap} range={ANONYMOUS_LIMITS.dailyCap} onChange={(n) => setDraft({ ...settings, daily_cap: n })} testId="anonymous-daily-cap" />
            <NumberSetting label="Minimum fill time" suffix="seconds" value={settings.min_fill_seconds} range={ANONYMOUS_LIMITS.minFillSeconds} onChange={(n) => setDraft({ ...settings, min_fill_seconds: n })} />
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={settings.uploads} onChange={(e) => setDraft({ ...settings, uploads: e.target.checked })} className="mt-0.5 accent-primary" data-testid="anonymous-uploads" />
            <span><span className="font-medium">Allow uploads</span> <span className="text-fg-muted">— Attachments fields take PDF, image, text or CSV files from anonymous visitors, within the limits below.</span></span>
          </label>
          {settings.uploads && (
            <div className="flex flex-wrap gap-4 pl-5">
              <NumberSetting label="Largest file" suffix="MB" value={settings.max_upload_mb} range={ANONYMOUS_LIMITS.maxUploadMb} onChange={(n) => setDraft({ ...settings, max_upload_mb: n })} />
              <NumberSetting label="Files per submission" value={settings.max_files} range={ANONYMOUS_LIMITS.maxFiles} onChange={(n) => setDraft({ ...settings, max_files: n })} />
            </div>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={settings.allow_indexing} onChange={(e) => setDraft({ ...settings, allow_indexing: e.target.checked })} className="mt-0.5 accent-primary" />
            <span><span className="font-medium">Let search engines index the page</span> <span className="text-fg-muted">— off: the page asks not to be indexed.</span></span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={settings.allow_friendly_link} onChange={(e) => setDraft({ ...settings, allow_friendly_link: e.target.checked })} className="mt-0.5 accent-primary" data-testid="anonymous-friendly-link" />
            <span>
              <span className="font-medium">Allow friendly public link</span>{' '}
              <span className="text-fg-muted">— visitors can also open the form at /form/&lt;system name&gt; on the workspace address. A system name is easy to guess, so anyone could find the form. Turning this off doesn&rsquo;t revoke access for visitors who already have the page: regenerate the link for that.</span>
            </span>
          </label>
          {access.captcha && <p className="text-2xs text-fg-muted">Bot protection: {access.captcha === 'turnstile' ? 'Cloudflare Turnstile' : 'hCaptcha'} (workspace setting).</p>}
          {dirty && <Button size="sm" disabled={busy} onClick={() => void apply({ settings }, 'Saved the anonymous limits')} data-testid="anonymous-save">Save limits</Button>}
        </fieldset>
      )}
      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
    </section>
  )
}
