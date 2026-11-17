import Link from "next/link"
import { ArrowRight, Check, Clock, ShieldCheck } from "lucide-react"
import { BetaBadge, MarketingFooter, MarketingHeader, ProductionReadyBadge } from "@/components/marketing/marketing-ui"
import { SharePointTrialForm } from "@/components/marketing/sharepoint-trial-form"
import { SHAREPOINT_PRICE, SHAREPOINT_TRIAL } from "@/lib/seo/sharepoint-facts"
import { breadcrumbNode, faqNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"
import { publicBaseUrl } from "@/lib/deployment"

const INCLUDED = [
  "Every feature of the SharePoint extension, on one farm",
  "The UserTasks button, generated forms inside SharePoint, list-event workflows",
  "InfoPath and SharePoint Designer 2010 importers",
  "Works on air-gapped farms: copy a request code, paste the licence back",
]

export const TRIAL_FAQS: Array<{ question: string; answer: string }> = [
  { question: "What do I need for the SharePoint trial?", answer: "A SharePoint Server 2016, 2019 or Subscription Edition farm, self-hosted UserTasks next to it (Docker or Kubernetes), a work email address and the farm ID. Get the farm ID by running (Get-SPFarm).Id in SharePoint Management Shell on a farm server." },
  { question: "How do I install the trial licence?", answer: "If UserTasks can reach usertasks.com, start the trial from Settings → Extensions and it installs itself. Otherwise sign in as an instance admin, open Settings → Licence and upload the .licence file from the email, or paste the licence text." },
  { question: "What happens when the trial ends?", answer: "The extension stops 24 hours after the trial expires, with warnings from 7 days before. Lists that use UserTasks forms go back to SharePoint's own forms and workflows started by SharePoint events pause. Nothing is deleted, and adding a licence puts the same forms back and resumes the paused workflows." },
  { question: "Can I have more than one trial?", answer: "There is one trial per farm and one per company email domain. Asking again for the same farm sends the same licence again. To try a second farm, contact us." },
]

/** /sharepoint/trial: why, what's included, the form (or "Contact us" until trials are switched on), the terms. */
export function SharePointTrialPage({ available, defaultCode = "" }: { available: boolean; defaultCode?: string }) {
  const baseUrl = publicBaseUrl()
  const jsonLd = [
    webPageNode(baseUrl, SHAREPOINT_TRIAL.path, { name: SHAREPOINT_TRIAL.title, description: SHAREPOINT_TRIAL.description }),
    breadcrumbNode(baseUrl, [{ name: "SharePoint on-premises", path: "/sharepoint" }, { name: "Free trial", path: SHAREPOINT_TRIAL.path }]),
    faqNode(TRIAL_FAQS),
  ]
  return (
    <div className="relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader />
      <main className="relative overflow-hidden">
        <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:py-20">
          <section>
            <p className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-bronze)/30 bg-(color:--mkt-white)/70 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)"><Clock size={13} aria-hidden="true" /> {SHAREPOINT_TRIAL.days}-day free trial · No card</p>
            <h1 className="mt-6 font-display text-display font-bold">Try UserTasks on <span className="mkt-gradient-text-ink">your own SharePoint farm.</span></h1>
            <p className="mt-5 max-w-lg mkt-body text-(color:--mkt-text)">Replace SharePoint 2010 workflows and InfoPath forms on SharePoint Server 2016, 2019 and Subscription Edition. Fill in the form and you get a signed trial licence for your farm straight away.</p>
            <ul className="mt-8 space-y-3">
              {INCLUDED.map((point) => <li key={point} className="flex gap-3 text-[15px] text-(color:--mkt-ink-soft)"><span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-green) text-white"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>{point}</li>)}
            </ul>
            <p className="mt-8 flex flex-wrap items-center gap-2 text-sm text-(color:--mkt-muted)">Self-hosted UserTasks <ProductionReadyBadge /> · UserTasks Cloud <BetaBadge /></p>
            <p className="mt-3 flex items-center gap-2 text-sm text-(color:--mkt-muted)"><ShieldCheck size={16} className="text-(color:--mkt-green)" aria-hidden="true" /> After the trial: {SHAREPOINT_PRICE.amount} {SHAREPOINT_PRICE.currency} {SHAREPOINT_PRICE.unit}, including {SHAREPOINT_PRICE.includes}.</p>
          </section>
          <section aria-label="Start your trial" className="self-start rounded-3xl border border-(color:--mkt-ink)/10 bg-(color:--mkt-white)/90 p-6 shadow-[0_40px_100px_-40px_rgba(27,25,22,0.45)] backdrop-blur sm:p-8">
            {available ? (
              <>
                <h2 className="text-xl font-semibold">Start your {SHAREPOINT_TRIAL.days}-day trial</h2>
                <p className="mb-6 mt-1 text-sm text-(color:--mkt-muted)">Already running self-hosted UserTasks? You can also start it from Settings → Extensions.</p>
                <SharePointTrialForm defaultCode={defaultCode} />
              </>
            ) : (
              <div data-testid="trial-unavailable">
                <h2 className="text-xl font-semibold">Trials aren&apos;t available yet</h2>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-muted)">Self-serve trials open soon. Tell us about your farm and we&apos;ll set one up for you.</p>
                <Link href="/contact" className="mkt-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold">Contact us <ArrowRight size={16} aria-hidden="true" /></Link>
              </div>
            )}
          </section>
        </div>

        <section className="relative border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight">Questions</h2>
            <div className="mt-6 space-y-3">
              {TRIAL_FAQS.map((faq) => (
                <details key={faq.question} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-5">
                  <summary className="cursor-pointer list-none"><h3 className="inline font-semibold">{faq.question}</h3></summary>
                  <p className="mt-3 text-sm leading-7 text-(color:--mkt-muted)">{faq.answer}</p>
                </details>
              ))}
            </div>
            <div id="terms" className="mt-12 scroll-mt-8 text-sm leading-7 text-(color:--mkt-muted)">
              <h2 className="text-lg font-semibold text-(color:--mkt-ink)">Trial terms</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                <li>The trial is free, for evaluation, for {SHAREPOINT_TRIAL.days} days from when the licence is issued, on the one SharePoint farm you name.</li>
                <li>One trial per farm and per company email domain. We may refuse or end trials that misuse this.</li>
                <li>We keep your name, work email, company, farm ID and (when UserTasks sent the request) its instance ID and address, to issue the licence, contact you about the trial and prevent repeat trials. We don&apos;t sell them.</li>
                <li>When the trial ends the extension stops 24 hours after expiry. Lists go back to SharePoint&apos;s own forms and SharePoint-triggered workflows pause; your data stays in your own systems and nothing is deleted.</li>
                <li>The trial comes as is, without support commitments. A paid licence ({SHAREPOINT_PRICE.amount} {SHAREPOINT_PRICE.currency} per farm per year) includes updates and support.</li>
              </ul>
            </div>
            <p className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/sharepoint" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">UserTasks for SharePoint <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/docs/sharepoint/trial" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Trial guide <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/install" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Install self-hosted UserTasks <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/contact" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Contact us <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
          </div>
        </section>
      </main>
      <MarketingFooter cta={false} />
    </div>
  )
}
