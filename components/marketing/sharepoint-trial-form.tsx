'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Rocket } from 'lucide-react'
import { TRIAL_REQUEST_PREFIX } from '@/lib/licensing/trial-request'

/**
 * The /sharepoint/trial form: name, work email, company, and the farm ID or
 * an installation's request code (air-gapped farms), terms, a honeypot.
 * Posts to /api/public/trials/sharepoint; on success the licence is kept in
 * this tab (sessionStorage) for /sharepoint/trial/started, which shows it
 * with the next steps. It is also emailed.
 */

export const TRIAL_RESULT_KEY = 'usertasks:sharepoint-trial'

const inputClass = 'w-full rounded-lg border border-(color:--mkt-ink)/10 bg-(color:--mkt-sand) px-4 py-3 text-base text-(color:--mkt-ink) placeholder:text-(color:--mkt-subtle) outline-none transition focus:border-(color:--mkt-primary)/60 focus:bg-(color:--mkt-white) focus:ring-2 focus:ring-(color:--mkt-primary)/20'
const labelClass = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-(color:--mkt-muted)'
const hintClass = 'mt-1 text-2xs leading-relaxed text-(color:--mkt-subtle)'

export function SharePointTrialForm({ defaultCode = '' }: { defaultCode?: string }) {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', company: '', farm: defaultCode, accept: false, website: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; field?: string; code?: string } | null>(null)
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: key === 'accept' ? (e.target as HTMLInputElement).checked : e.target.value }))
  const isCode = form.farm.trim().startsWith(TRIAL_REQUEST_PREFIX)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/public/trials/sharepoint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name, email: form.email, company: form.company, accept_terms: form.accept, website: form.website, source: 'website',
          ...(isCode ? { request_code: form.farm.trim() } : { farm_id: form.farm.trim() }),
        }),
      })
      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || !body.licence) {
        setError({ message: typeof body.error === 'string' ? body.error : 'The trial could not be started. Please try again, or contact us.', field: typeof body.field === 'string' ? body.field : undefined, code: typeof body.code === 'string' ? body.code : undefined })
        setBusy(false)
        return
      }
      try { sessionStorage.setItem(TRIAL_RESULT_KEY, JSON.stringify({ ...body, email: form.email, fromCode: isCode })) } catch { /* private mode: the email still has it */ }
      router.push('/sharepoint/trial/started')
    } catch {
      setError({ message: 'The trial could not be started (network error). Please try again.' })
      setBusy(false)
    }
  }

  const fieldError = (f: string) => (error?.field === f ? <p className="mt-1 text-xs text-(color:--mkt-red)" role="alert">{error.message}</p> : null)

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={busy} data-testid="sharepoint-trial-form">
      <input type="text" name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="trial-name" className={labelClass}>Your name</label>
          <input id="trial-name" required value={form.name} onChange={set('name')} placeholder="Alex Rivera" className={inputClass} disabled={busy} autoComplete="name" />
          {fieldError('name')}
        </div>
        <div>
          <label htmlFor="trial-company" className={labelClass}>Company</label>
          <input id="trial-company" required value={form.company} onChange={set('company')} placeholder="Fabrikam Ltd" className={inputClass} disabled={busy} autoComplete="organization" />
          {fieldError('company')}
        </div>
      </div>
      <div>
        <label htmlFor="trial-email" className={labelClass}>Work email</label>
        <input id="trial-email" required type="email" value={form.email} onChange={set('email')} placeholder="alex@fabrikam.example" className={inputClass} disabled={busy} autoComplete="email" />
        <p className={hintClass}>We email the licence here. Personal and disposable addresses can&apos;t be used: one trial per company.</p>
        {fieldError('email')}
      </div>
      <div>
        <label htmlFor="trial-farm" className={labelClass}>SharePoint farm ID or request code</label>
        <textarea id="trial-farm" required rows={isCode ? 4 : 1} value={form.farm} onChange={set('farm')} placeholder="3f2504e0-4f89-11d3-9a0c-0305e82c3301" className={`${inputClass} font-mono text-sm`} disabled={busy} spellCheck={false} />
        <p className={hintClass}>In SharePoint Management Shell on a farm server run <code className="font-mono">(Get-SPFarm).Id</code>. Or paste the request code UserTasks shows when it can&apos;t reach the internet (it starts with {TRIAL_REQUEST_PREFIX}).</p>
        {fieldError('farm_id')}{fieldError('request_code')}
      </div>
      <label className="flex items-start gap-2 text-sm text-(color:--mkt-ink-soft)">
        <input type="checkbox" checked={form.accept} onChange={set('accept')} className="mt-1" disabled={busy} required />
        <span>I accept the <a href="#terms" className="font-semibold text-(color:--mkt-bronze) hover:underline">trial terms</a>.</span>
      </label>
      {fieldError('accept_terms')}
      {error && !error.field && (
        <p role="alert" className="rounded-lg border border-(color:--mkt-red)/30 bg-(color:--mkt-red)/[0.06] px-4 py-2.5 text-sm text-(color:--mkt-red)">
          {error.message}{' '}
          {(error.code === 'trial_used' || error.code === 'trial_exists_for_domain' || error.code === 'trials_unavailable') && <a href="/contact" className="font-semibold underline">Contact us</a>}
        </p>
      )}
      <button type="submit" disabled={busy} className="group flex w-full items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3.5 text-sm font-semibold text-(color:--mkt-paper) transition hover:bg-(color:--mkt-primary-hover) disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Rocket className="h-4 w-4" aria-hidden="true" />}
        {busy ? 'Signing your licence…' : 'Start my 30-day free trial'}
      </button>
      <p className="text-center text-xs text-(color:--mkt-subtle)">No card. One trial per farm and per company. After the trial: $7,500 USD per farm per year.</p>
    </form>
  )
}
