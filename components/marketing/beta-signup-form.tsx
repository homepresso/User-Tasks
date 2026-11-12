'use client'

import { useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { useRouter } from 'next/navigation'
import { betaSignup } from '@/app/actions/beta-signup'
import { passwordSignInAction } from '@/app/actions/auth'
import { CheckCircle2, Loader2, Rocket } from 'lucide-react'
import Link from 'next/link'
import { completeBetaSignup } from '@/lib/signup-link'

const COMPANY_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+']

/**
 * Beta signup form — provisions a new tenant via the betaSignup server action,
 * then signs the user straight in and lands them on `redirect` (a safe
 * same-origin path, e.g. the CLI's OAuth authorize), the known `next`
 * destination, or the dashboard (postSignupDestination; no open redirects).
 */
export function BetaSignupForm({ defaultEmail = '', next, redirect = null }: { defaultEmail?: string; next?: string | null; redirect?: string | null }) {
  const router = useRouter()
  const [form, setForm] = useState({
    fullName: '',
    email: defaultEmail,
    password: '',
    company: '',
    companySize: '',
    useCase: '',
    website: '', // honeypot
  })
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'provisioning' | 'signing-in' | 'done'>('idle')
  // Synchronous guard: a double click / Enter in one frame would sign up twice.
  const signupGuard = useSubmitGuard()

  const busy = phase === 'provisioning' || phase === 'signing-in'

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await signupGuard.run(async () => {
      setError(null)
      setPhase('provisioning')
      try {
        const outcome = await completeBetaSignup(form, { redirect, next }, {
          signup: betaSignup,
          // Server-side sign-in: the action sets the httpOnly session cookies.
          signIn: passwordSignInAction,
          onProvisioned: () => setPhase('signing-in'),
        })
        if (outcome.kind === 'error') {
          setError(outcome.error)
          setPhase('idle')
          return
        }
        if (outcome.kind === 'sign_in') {
          // Workspace exists — fall back to the login page rather than erroring.
          router.push(outcome.href)
          return
        }
        setPhase('done')
        // A full navigation: the sign-in action's response already carried the
        // session cookies, so the next request (e.g. /api/oauth/authorize) sees the user.
        window.location.href = outcome.href
      } catch {
        setError('Something went wrong — please try again.')
        setPhase('idle')
      }
    })
  }

  const inputClass =
    // text-base (16px), not text-sm — iOS Safari auto-zooms the page on focus
    // for any input/select under 16px, which reads as "the page is broken".
    'w-full rounded-lg border border-(color:--mkt-ink)/10 bg-(color:--mkt-sand) px-4 py-3 text-base text-(color:--mkt-ink) placeholder:text-(color:--mkt-subtle) outline-none transition focus:border-(color:--mkt-primary)/60 focus:bg-(color:--mkt-white) focus:ring-2 focus:ring-(color:--mkt-primary)/20'

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-busy={busy}>
      {/* honeypot — visually hidden, tab-skipped */}
      <input
        type="text"
        name="website"
        value={form.website}
        onChange={set('website')}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="sr-only"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="beta-name" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-(color:--mkt-muted)">Your name</label>
          <input id="beta-name" required value={form.fullName} onChange={set('fullName')} placeholder="Ada Lovelace" className={inputClass} disabled={busy} />
        </div>
        <div>
          <label htmlFor="beta-company" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-(color:--mkt-muted)">Company</label>
          <input id="beta-company" required value={form.company} onChange={set('company')} placeholder="Acme Inc" className={inputClass} disabled={busy} />
          <p className="mt-1 text-2xs leading-relaxed text-(color:--mkt-subtle)">Used to name your private workspace. You can change it later.</p>
        </div>
      </div>

      <div>
        <label htmlFor="beta-email" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-(color:--mkt-muted)">Work email</label>
        <input id="beta-email" required type="email" value={form.email} onChange={set('email')} placeholder="ada@acme.com" className={inputClass} disabled={busy} autoComplete="email" />
        <p className="mt-1 text-2xs leading-relaxed text-(color:--mkt-subtle)">You become the workspace owner and can invite your team after setup.</p>
      </div>

      <div>
        <label htmlFor="beta-password" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-(color:--mkt-muted)">Password</label>
        <input id="beta-password" required type="password" minLength={8} value={form.password} onChange={set('password')} placeholder="At least 8 characters" className={inputClass} disabled={busy} autoComplete="new-password" />
        <p className="mt-1 text-2xs leading-relaxed text-(color:--mkt-subtle)">Use at least 8 characters. Enterprise SSO can be configured from workspace settings.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="beta-size" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-(color:--mkt-muted)">Team size <span className="normal-case text-(color:--mkt-subtle)">(optional)</span></label>
          <select id="beta-size" value={form.companySize} onChange={set('companySize')} className={inputClass} disabled={busy}>
            <option value="" className="bg-(color:--mkt-canvas)">Select…</option>
            {COMPANY_SIZES.map((s) => (
              <option key={s} value={s} className="bg-(color:--mkt-canvas)">{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="beta-usecase" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-(color:--mkt-muted)">What will you automate? <span className="normal-case text-(color:--mkt-subtle)">(optional)</span></label>
          <input id="beta-usecase" value={form.useCase} onChange={set('useCase')} placeholder="Approvals, onboarding, reporting…" className={inputClass} disabled={busy} />
          <p className="mt-1 text-2xs leading-relaxed text-(color:--mkt-subtle)">This helps us understand what you want to build; it does not limit your workspace.</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-(color:--mkt-red)/30 bg-(color:--mkt-red)/[0.06] px-4 py-2.5 text-sm text-(color:--mkt-red)">{error}</p>
      )}

      {/* Provisioning takes a few seconds — show a live progress treatment. */}
      {busy && (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(67,62,60,0.10)]">
            <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-(color:--mkt-primary) via-[#E9DCC3] to-(color:--mkt-primary) bg-[length:200%_100%]"
              style={{ width: phase === 'signing-in' ? '85%' : '45%', transition: 'width 1.5s ease' }} />
          </div>
          <p className="text-xs text-(color:--mkt-muted)">
            {phase === 'provisioning' ? 'Creating your isolated workspace…' : 'Signing you in…'}
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="group flex w-full items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3.5 text-sm font-semibold text-(color:--mkt-paper) transition hover:bg-(color:--mkt-primary-hover) disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : phase === 'done' ? (
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Rocket className="h-4 w-4 transition group-hover:-translate-y-0.5" aria-hidden="true" />
        )}
        {phase === 'done' ? 'Workspace ready — redirecting…' : busy ? 'Setting things up…' : 'Claim your free beta workspace'}
      </button>

      <p className="text-center text-xs text-(color:--mkt-subtle)">
        Free during the beta · No credit card · Your data lives in its own isolated tenant
      </p>
      <div className="grid grid-cols-3 gap-2 border-t border-(color:--mkt-ink)/[0.06] pt-4 text-center">
        <div><p className="text-sm font-semibold text-(color:--mkt-ink)">Full access</p><p className="text-2xs text-(color:--mkt-subtle)">No feature-gated trial</p></div>
        <div><p className="text-sm font-semibold text-(color:--mkt-ink)">Your team</p><p className="text-2xs text-(color:--mkt-subtle)">No per-seat beta fee</p></div>
        <div><p className="text-sm font-semibold text-(color:--mkt-ink)">Real workflows</p><p className="text-2xs text-(color:--mkt-subtle)">Build beyond a demo</p></div>
      </div>
      <p className="text-center text-2xs text-(color:--mkt-subtle)">Want to evaluate the platform first? <Link href="/docs" className="font-medium text-(color:--mkt-bronze) hover:underline">Read the public documentation</Link>.</p>
    </form>
  )
}
