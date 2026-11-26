import type { CSSProperties } from "react"
import Link from "next/link"
import { ArrowRight, BookOpen, Building2, Check, GitFork, GraduationCap, Headset, Landmark, LifeBuoy, Mail, Phone, Server, Users } from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { CheckList, FaqList, MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/marketing-ui"
import { publicBaseUrl } from "@/lib/deployment"
import { repositoryUrl } from "@/lib/site-links"
import { breadcrumbNode, faqNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"
import {
  CONSULTING, SUPPORT_CONTACT_HREF, SUPPORT_FAQS, SUPPORT_INCLUDES, SUPPORT_PAGE, SUPPORT_PLANS, SUPPORT_UPDATED,
  supportServiceNodes, type SupportPlan, type SupportPlanId,
} from "@/lib/seo/support"

/**
 * /support: the paid support plans and consulting (lib/seo/support.ts).
 * States only the owner's facts: four plans (three monthly USD prices, the
 * public sector on request), email support with phone support when needed,
 * and consultants from $250 an hour. No response times or SLAs.
 */

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

const PLAN_ICONS: Record<SupportPlanId, typeof Users> = { smb: Users, "mid-market": Building2, enterprise: Server, "public-sector": Landmark }
const INCLUDE_ICONS = [Mail, Phone]

function PlanPrice({ plan }: { plan: SupportPlan }) {
  if (!plan.price) {
    return (
      <div>
        <p className="font-display text-4xl font-bold tracking-tight">Contact us</p>
        <p className="mt-1 text-sm text-(color:--mkt-text)">Priced on request</p>
      </div>
    )
  }
  return (
    <div>
      <p className="font-display text-4xl font-bold tracking-tight">{plan.price.amount}<span className="ml-1 text-base font-semibold text-(color:--mkt-muted)">{plan.price.currency}</span></p>
      <p className="mt-1 text-sm text-(color:--mkt-text)">{plan.price.unit}</p>
    </div>
  )
}

function PlanCard({ plan }: { plan: SupportPlan }) {
  const Icon = PLAN_ICONS[plan.id]
  const headingId = `plan-${plan.id}-title`
  return (
    <article aria-labelledby={headingId} className="flex h-full flex-col rounded-3xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) p-6 shadow-[0_30px_80px_-50px_rgba(16,14,11,0.35)]" data-reveal data-support-plan={plan.id}>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2A251E] to-[#14110D] text-[#F0C27B] shadow-lg"><Icon size={22} aria-hidden="true" /></span>
      <h3 id={headingId} className="mt-5 font-display text-2xl font-bold tracking-tight">{plan.name}</h3>
      <div className="mt-4 border-t border-(color:--mkt-ink)/[0.07] pt-4"><PlanPrice plan={plan} /></div>
      <ul className="mt-5 space-y-1.5 text-sm leading-6 text-(color:--mkt-text)">
        {SUPPORT_INCLUDES.map((item) => <li key={item.title} className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span>{item.title}</span></li>)}
      </ul>
      <div className="mt-auto pt-7">
        <Link href={SUPPORT_CONTACT_HREF} className="mkt-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold" data-testid={`support-cta-${plan.id}`}>
          {plan.cta}<span className="sr-only"> about the {plan.name} plan</span> <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}

/** Dark mini-cards in the hero: each plan and its price at a glance. */
function HeroOverview() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {SUPPORT_PLANS.map((plan) => {
        const Icon = PLAN_ICONS[plan.id]
        return (
          <li key={plan.id}>
            <a href={`#plan-${plan.id}`} className="flex h-full flex-col rounded-2xl border border-white/10 bg-[#fff]/[0.04] p-5 text-[#F4EFE4] transition-colors hover:border-white/25">
              <span className="flex items-center gap-2 font-semibold"><Icon size={17} className="text-[#F0C27B]" aria-hidden="true" />{plan.name}</span>
              <span className="mt-4 font-display text-2xl font-bold text-white">
                {plan.price ? <>{plan.price.amount} <span className="text-sm font-semibold text-[#A89E8C]">USD {plan.price.unit}</span></> : <>Contact us <span className="text-sm font-semibold text-[#A89E8C]">for a quote</span></>}
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export function SupportPage() {
  const baseUrl = publicBaseUrl()
  const path = SUPPORT_PAGE.path
  const repoUrl = repositoryUrl()
  const jsonLd = [
    webPageNode(baseUrl, path, { name: SUPPORT_PAGE.title, description: SUPPORT_PAGE.description, updated: SUPPORT_UPDATED }),
    breadcrumbNode(baseUrl, [{ name: "Extensions", path: "/extensions" }, { name: SUPPORT_PAGE.eyebrow, path }]),
    ...supportServiceNodes(baseUrl),
    faqNode(SUPPORT_FAQS),
  ]

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb="Extensions / Support"
          eyebrow="Extensions · support plans"
          icon={LifeBuoy}
          title={<>Support from the team that <span className="mkt-gradient-text">builds UserTasks.</span></>}
          intro={<>Paid support plans for teams running UserTasks: <strong className="text-white">email support, and phone support when needed.</strong> Plans are priced per month in USD, and consultants are on hand from $250 an hour.</>}
          primary={{ href: "#plans", label: "Compare the plans" }}
          secondary={{ href: SUPPORT_CONTACT_HREF, label: "Talk to us" }}
          bullets={["Email support, and phone support when needed", "Monthly plans, priced in USD", `Consultants from ${CONSULTING.rate.amount} USD ${CONSULTING.rate.unit}`]}
          visual={<HeroOverview />}
        />

        <section id="plans" aria-labelledby="plans-title" className="scroll-mt-20 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/60">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-3xl text-center" data-reveal>
              <p className="inline-flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)"><span aria-hidden="true" className="h-px w-6 bg-gradient-to-r from-transparent to-(color:--mkt-gold)" />Support plans</p>
              <h2 id="plans-title" className="mt-3 font-display text-3xl font-bold tracking-tight text-balance sm:text-[2.75rem] sm:leading-[1.08]">Four plans, priced per month.</h2>
              <p className="mt-4 mkt-body text-pretty text-(color:--mkt-text)">Every plan includes email support, and phone support when needed. Public sector plans are quoted on request.</p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {SUPPORT_PLANS.map((plan) => <div key={plan.id} id={`plan-${plan.id}`} className="scroll-mt-24"><PlanCard plan={plan} /></div>)}
            </div>
            <p className="mt-8 text-center text-sm text-(color:--mkt-text)">{SUPPORT_PAGE.detailsNote}</p>
          </div>
        </section>

        <section aria-labelledby="included-title" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">What&rsquo;s included</p>
              <h2 id="included-title" className="mt-3 font-display text-3xl font-bold tracking-tight">Email, and the phone when needed</h2>
              <p className="mt-4 mkt-body text-(color:--mkt-text)">{SUPPORT_PAGE.definition}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {SUPPORT_INCLUDES.map((item, index) => {
                const Icon = INCLUDE_ICONS[index % INCLUDE_ICONS.length]
                return (
                  <li key={item.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-5" data-reveal>
                    <Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                    <h3 className="mt-2 font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{item.body}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <section id="consulting" aria-labelledby="consulting-title" className="scroll-mt-20 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) shadow-[0_30px_80px_-40px_rgba(16,14,11,0.35)]">
              <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-(color:--mkt-bronze)"><Headset size={16} aria-hidden="true" /> Consulting</p>
                  <h2 id="consulting-title" className="mt-3 font-display text-3xl font-bold tracking-tight">Consultants on hand</h2>
                  <p className="mt-4 font-display text-5xl font-bold tracking-tight"><span className="text-base font-semibold text-(color:--mkt-muted)">from </span>{CONSULTING.rate.amount}<span className="ml-1 text-base font-semibold text-(color:--mkt-muted)">{CONSULTING.rate.currency}</span></p>
                  <p className="mt-1 text-sm text-(color:--mkt-text)">{CONSULTING.rate.unit}</p>
                  <Link href={SUPPORT_CONTACT_HREF} className="mkt-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold" data-testid="consulting-cta">Talk to us about consulting <ArrowRight size={16} aria-hidden="true" /></Link>
                </div>
                <div>
                  <p className="text-sm leading-6 text-(color:--mkt-text)">{CONSULTING.summary} Tell us what you are working on and we&rsquo;ll talk it through with you.</p>
                  <CheckList items={CONSULTING.areas} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="community-title" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Open source" title={<span id="community-title">Paid support is optional.</span>}>
              UserTasks is open source under Apache-2.0 and free to run. The documentation, tutorials and install guides are free for everyone, so you can run the open-source edition without a plan.
            </SectionHeading>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { href: "/docs", label: "Documentation", icon: BookOpen, external: false },
                { href: "/docs/tutorials", label: "Tutorials", icon: GraduationCap, external: false },
                { href: "/open-source", label: "Open source", icon: GitFork, external: false },
                ...(repoUrl ? [{ href: repoUrl, label: "Source code on GitHub", icon: GitFork, external: true }] : [{ href: "/install", label: "Install guide", icon: Server, external: false }]),
              ].map((item) => {
                const Icon = item.icon
                const className = "mkt-lift flex h-full items-center justify-between gap-3 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5 font-semibold hover:border-(color:--mkt-bronze)/40"
                const body = <><span className="flex items-center gap-2"><Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />{item.label}</span><ArrowRight size={15} className="text-(color:--mkt-bronze)" aria-hidden="true" /></>
                return <li key={item.href}>{item.external ? <a href={item.href} className={className}>{body}</a> : <Link href={item.href} className={className}>{body}</Link>}</li>
              })}
            </ul>
          </div>
        </section>

        <div className="border-t border-(color:--mkt-ink)/[0.07]">
          <FaqList faqs={SUPPORT_FAQS} />
        </div>

        <section className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/extensions" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">All extensions <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/install" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Install UserTasks <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/deploy-anywhere" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Deploy anywhere <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href={SUPPORT_CONTACT_HREF} className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Contact us <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
