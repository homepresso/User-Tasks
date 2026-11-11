import Link from "next/link"
import { Check, ShieldCheck, Sparkles } from "lucide-react"
import { BetaSignupForm } from "@/components/marketing/beta-signup-form"
import { MarketingFooter, MarketingHeader } from "@/components/marketing/marketing-ui"
import { NavArt } from "@/components/marketing/nav-art"

const POINTS = [
  "Workflows, forms, tasks, data tables and reports",
  "The Agent on every screen, on your own AI provider key",
  "Invite your team; roles and permissions from day one",
  "Export everything as config as code, and self-host whenever you like",
]

/** /start: the cloud sign-up page the "Start free" buttons lead to. */
export function StartPage({ email, next = null }: { email: string; next?: string | null }) {
  return (
    <div className="relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      <MarketingHeader />
      <main className="relative overflow-hidden">
        <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-10 size-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.28),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 bottom-0 size-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(139,124,246,0.18),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:py-20">
          <section>
            <p className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-bronze)/30 bg-(color:--mkt-white)/70 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)"><Sparkles size={13} aria-hidden="true" /> Free during the beta</p>
            <h1 className="mt-6 font-display text-display font-bold">Your workspace, <span className="mkt-gradient-text-ink">ready in a minute.</span></h1>
            <p className="mt-5 max-w-lg mkt-body text-(color:--mkt-text)">One form and you have your own isolated UserTasks workspace. Describe a process to the Agent, or start from a ready-made package.</p>
            <ul className="mt-8 space-y-3">
              {POINTS.map((point) => <li key={point} className="flex gap-3 text-[15px] text-(color:--mkt-ink-soft)"><span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-green) text-white"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>{point}</li>)}
            </ul>
            <div className="mt-10 grid max-w-md grid-cols-3 gap-3" aria-hidden="true">
              <NavArt kind="agent" live className="h-20" />
              <NavArt kind="forms" live className="h-20" />
              <NavArt kind="workflows" live className="h-20" />
            </div>
            <p className="mt-8 flex items-center gap-2 text-sm text-(color:--mkt-muted)"><ShieldCheck size={16} className="text-(color:--mkt-green)" aria-hidden="true" /> Open source under Apache-2.0: your processes are never locked in.</p>
          </section>
          <section aria-label="Create your workspace" className="rounded-3xl border border-(color:--mkt-ink)/10 bg-(color:--mkt-white)/90 p-6 shadow-[0_40px_100px_-40px_rgba(27,25,22,0.45)] backdrop-blur sm:p-8">
            <h2 className="text-xl font-semibold">Create your workspace</h2>
            <p className="mb-6 mt-1 text-sm text-(color:--mkt-muted)">Already have one? <Link href="/login" className="font-semibold text-(color:--mkt-ink) underline-offset-4 hover:underline">Sign in</Link></p>
            {next === 'infopath' && <p className="mb-4 rounded-xl border border-(color:--mkt-bronze)/30 bg-(color:--mkt-gold)/[0.10] px-4 py-3 text-sm text-(color:--mkt-ink-soft)" data-testid="start-infopath-note">After sign-up your InfoPath form opens in the importer. Your file stays in this browser, not on our servers: if it doesn't come across, choose it again.</p>}
            <BetaSignupForm defaultEmail={email} next={next} />
          </section>
        </div>
      </main>
      <MarketingFooter cta={false} />
    </div>
  )
}
