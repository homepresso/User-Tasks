'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { betaSignup } from '@/app/actions/beta-signup'
import { passwordSignInAction } from '@/app/actions/auth'
import { CheckCircle2, Loader2, Rocket } from 'lucide-react'
import Link from 'next/link'

const COMPANY_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+']

/**
 * Beta signup form — provisions a new tenant via the betaSignup server action,
 * then signs the user straight in and lands them on the dashboard.
 */
export function BetaSignupForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    company: '',
    companySize: '',
    useCase: '',
    website: '', // honeypot
  })
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'provisioning' | 'signing-in' | 'done'>('idle')

  const busy = phase === 'provisioning' || phase === 'signing-in'

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPhase('provisioning')
    try {
      const result = await betaSignup(form)
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong — please try again.')
        setPhase('idle')
        return
      }

      setPhase('signing-in')
      // Server-side sign-in: the action sets the httpOnly session cookies.
      const signedIn = await passwordSignInAction(form.email.trim(), form.password)
      if (!signedIn.ok) {
        // Workspace exists — fall back to the login page rather than erroring.
        router.push('/login')
        return
      }
      setPhase('done')
      window.location.href = '/tasks'
    } catch {
      setError('Something went wrong — please try again.')
      setPhase('idle')
    }
  }

  const inputClass =
    // text-base (16px), not text-sm — iOS Safari auto-zooms the page on focus
    // for any input/select under 16px, which reads as "the page is broken".
    'w-full rounded-lg border border-[#1B1916]/10 bg-[#F1EDE3] px-4 py-3 text-base text-[#1B1916] placeholder:text-[#857D6D] outline-none transition focus:border-[#17150F]/60 focus:bg-[#102943] focus:ring-2 focus:ring-[#17150F]/20'

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
          <label htmlFor="beta-name" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#6E6759]">Your name</label>
          <input id="beta-name" required value={form.fullName} onChange={set('fullName')} placeholder="Ada Lovelace" className={inputClass} disabled={busy} />
        </div>
        <div>
          <label htmlFor="beta-company" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#6E6759]">Company</label>
          <input id="beta-company" required value={form.company} onChange={set('company')} placeholder="Acme Inc" className={inputClass} disabled={busy} />
          <p className="mt-1 text-[10px] leading-relaxed text-[#857D6D]">Used to name your private workspace. You can change it later.</p>
        </div>
      </div>

      <div>
        <label htmlFor="beta-email" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#6E6759]">Work email</label>
        <input id="beta-email" required type="email" value={form.email} onChange={set('email')} placeholder="ada@acme.com" className={inputClass} disabled={busy} autoComplete="email" />
        <p className="mt-1 text-[10px] leading-relaxed text-[#857D6D]">You become the workspace owner and can invite your team after setup.</p>
      </div>

      <div>
        <label htmlFor="beta-password" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#6E6759]">Password</label>
        <input id="beta-password" required type="password" minLength={8} value={form.password} onChange={set('password')} placeholder="At least 8 characters" className={inputClass} disabled={busy} autoComplete="new-password" />
        <p className="mt-1 text-[10px] leading-relaxed text-[#857D6D]">Use at least 8 characters. Enterprise SSO can be configured from workspace settings.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="beta-size" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#6E6759]">Team size <span className="normal-case text-[#857D6D]">(optional)</span></label>
          <select id="beta-size" value={form.companySize} onChange={set('companySize')} className={inputClass} disabled={busy}>
            <option value="" className="bg-[#F5F2EA]">Select…</option>
            {COMPANY_SIZES.map((s) => (
              <option key={s} value={s} className="bg-[#F5F2EA]">{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="beta-usecase" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#6E6759]">What will you automate? <span className="normal-case text-[#857D6D]">(optional)</span></label>
          <input id="beta-usecase" value={form.useCase} onChange={set('useCase')} placeholder="Approvals, onboarding, reporting…" className={inputClass} disabled={busy} />
          <p className="mt-1 text-[10px] leading-relaxed text-[#857D6D]">This helps us understand what you want to build; it does not limit your workspace.</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{error}</p>
      )}

      {/* Provisioning takes a few seconds — show a live progress treatment. */}
      {busy && (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(67,62,60,0.10)]">
            <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[#17150F] via-[#E9DCC3] to-[#17150F] bg-[length:200%_100%]"
              style={{ width: phase === 'signing-in' ? '85%' : '45%', transition: 'width 1.5s ease' }} />
          </div>
          <p className="text-xs text-[#6E6759]">
            {phase === 'provisioning' ? 'Creating your isolated workspace…' : 'Signing you in…'}
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="group flex w-full items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3.5 text-sm font-semibold text-[#FAF8F3] transition hover:bg-[#2E2A24] disabled:cursor-not-allowed disabled:opacity-60"
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

      <p className="text-center text-xs text-[#857D6D]">
        Free during the beta · No credit card · Your data lives in its own isolated tenant
      </p>
      <div className="grid grid-cols-3 gap-2 border-t border-[#1B1916]/[0.06] pt-4 text-center">
        <div><p className="text-sm font-semibold text-[#1B1916]">Full access</p><p className="text-[9px] text-[#857D6D]">No feature-gated trial</p></div>
        <div><p className="text-sm font-semibold text-[#1B1916]">Your team</p><p className="text-[9px] text-[#857D6D]">No per-seat beta fee</p></div>
        <div><p className="text-sm font-semibold text-[#1B1916]">Real workflows</p><p className="text-[9px] text-[#857D6D]">Build beyond a demo</p></div>
      </div>
      <p className="text-center text-[10px] text-[#857D6D]">Want to evaluate the platform first? <Link href="/docs" className="font-medium text-[#8A6D45] hover:underline">Read the public documentation</Link>.</p>
    </form>
  )
}
