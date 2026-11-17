'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, Download } from 'lucide-react'
import { MarketingFooter, MarketingHeader } from '@/components/marketing/marketing-ui'
import { TRIAL_RESULT_KEY } from '@/components/marketing/sharepoint-trial-form'

interface TrialResult {
  licence: Record<string, unknown>
  licence_id: string
  farm_id: string
  expires_at: string
  existing: boolean
  message: string
  email: string
}

const STEPS = [
  { title: 'Sign in to UserTasks as an instance admin', body: 'Self-hosted UserTasks next to your farm. No UserTasks yet? Install it with one command (Docker), then come back.' },
  { title: 'Install the licence', body: 'Settings → Licence → upload the .licence file, or paste the licence. (If you started from inside UserTasks, it is already installed.)' },
  { title: 'Turn on SharePoint', body: 'Settings → Extensions → SharePoint → Enabled, then connect a site of the farm you named.' },
  { title: 'Install the add-in and build', body: 'Download the add-in package and its PowerShell script from UserTasks, add it to your App Catalog, and click UserTasks on any list.' },
]

/** /sharepoint/trial/started: the licence (from this tab) and what to do next. */
export function SharePointTrialStarted() {
  const [result, setResult] = useState<TrialResult | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TRIAL_RESULT_KEY)
      if (raw) setResult(JSON.parse(raw) as TrialResult)
    } catch { /* private mode */ }
  }, [])
  const text = result ? `${JSON.stringify(result.licence, null, 2)}\n` : ''
  const ends = result ? new Date(result.expires_at).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' }) : ''

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `usertasks-sharepoint-trial-${result!.farm_id.slice(0, 8)}.licence`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:py-20">
        <p className="inline-flex items-center gap-2 rounded-full bg-(color:--mkt-green)/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-green)"><Check size={13} aria-hidden="true" /> Trial ready</p>
        <h1 className="mt-5 font-display text-4xl font-bold tracking-tight">Your SharePoint trial has started.</h1>
        {result ? (
          <p className="mt-4 mkt-body text-(color:--mkt-text)" data-testid="trial-started-message">{result.message} It runs until <strong>{ends}</strong> on farm <code className="font-mono text-sm">{result.farm_id}</code>.</p>
        ) : (
          <p className="mt-4 mkt-body text-(color:--mkt-text)">We&apos;ve emailed your licence. Open the email and follow the steps below.</p>
        )}
        {result && (
          <div className="mt-8 rounded-2xl border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">Licence <code className="font-mono text-xs">{result.licence_id}</code></p>
              <div className="flex gap-2">
                <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-(color:--mkt-ink)/15 px-3 py-1.5 text-sm font-semibold"><Download size={14} aria-hidden="true" /> Download .licence</button>
                <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => undefined)} className="inline-flex items-center gap-1.5 rounded-lg border border-(color:--mkt-ink)/15 px-3 py-1.5 text-sm font-semibold">{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}</button>
              </div>
            </div>
            <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-(color:--mkt-sand) p-3 text-xs leading-5">{text}</pre>
          </div>
        )}
        <h2 className="mt-12 text-xl font-semibold">Next steps</h2>
        <p className="mt-2 text-sm text-(color:--mkt-muted)">The full walkthrough, with every command: <Link href="/sharepoint/get-started" className="font-semibold text-(color:--mkt-bronze) hover:underline">Get started in 4 steps</Link>.</p>
        <ol className="mt-4 space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-ink) text-sm font-semibold text-(color:--mkt-paper)">{i + 1}</span>
              <div><p className="font-semibold">{step.title}</p><p className="text-sm leading-6 text-(color:--mkt-muted)">{step.body}</p></div>
            </li>
          ))}
        </ol>
        <p className="mt-10 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-4 text-sm leading-6 text-(color:--mkt-muted)">When the trial ends, the extension stops 24 hours later. Lists go back to SharePoint&apos;s own forms and SharePoint-triggered workflows pause; nothing is deleted. A licence ($7,500 USD per farm per year) brings everything back.</p>
        <p className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href="/docs/sharepoint/trial" className="font-semibold text-(color:--mkt-bronze) hover:underline">Trial guide</Link>
          <Link href="/install" className="font-semibold text-(color:--mkt-bronze) hover:underline">Install UserTasks</Link>
          <Link href="/docs/sharepoint" className="font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint docs</Link>
          <Link href="/contact" className="font-semibold text-(color:--mkt-bronze) hover:underline">Buy or ask a question</Link>
        </p>
      </main>
      <MarketingFooter cta={false} />
    </div>
  )
}
