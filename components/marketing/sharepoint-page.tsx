import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowRight, Blocks, Building2, Check, Cloud, Code2, FileInput, FileStack, FolderTree, KeyRound, ListChecks, Lock, MousePointerClick, Network,
  PackageCheck, Server, ShieldCheck, Users, Workflow, Zap, WifiOff,
} from "lucide-react"
import Image, { type StaticImageData } from "next/image"
import { ProductHero } from "@/components/marketing/product-hero"
import { ScreenshotFrame } from "@/components/marketing/screenshot-frame"
import { BetaBadge, MarketingFooter, MarketingHeader, ProductionReadyBadge, SectionHeading } from "@/components/marketing/marketing-ui"
import { SHAREPOINT_PAGE } from "@/lib/marketing-pages"
import { publicBaseUrl } from "@/lib/deployment"
import { breadcrumbNode, displayDate, faqNode, howToNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"
import { ALTERNATIVES_COMPARISON, KB5002945_QUOTE, MS, NINTEX_SE_DOCS, SHAREPOINT_FAQS, SHAREPOINT_KEY_FACTS, SHAREPOINT_PRICE, SHAREPOINT_TIMELINE, SHAREPOINT_TRIAL, SHAREPOINT_GET_STARTED } from "@/lib/seo/sharepoint-facts"
import shotForm from "@/public/screenshots/sharepoint-form-embedded.webp"
import shotFormDetail from "@/public/screenshots/sharepoint-form-detail.webp"
import shotLibrary from "@/public/screenshots/sharepoint-library-button.webp"
import shotSetup from "@/public/screenshots/sharepoint-setup.webp"
import shotDesigner from "@/public/screenshots/sharepoint-designer.webp"
import shotDisplay from "@/public/screenshots/sharepoint-display-approved.webp"
import shotOverview from "@/public/screenshots/sharepoint-dashboard-overview.webp"
import shotMetrics from "@/public/screenshots/sharepoint-dashboard-metrics.webp"
import shotRuns from "@/public/screenshots/sharepoint-dashboard-runs.webp"
import shotPermissions from "@/public/screenshots/sharepoint-dashboard-permissions.webp"
import shotStartMenu from "@/public/screenshots/sharepoint-start-menu.webp"
import shotStartPage from "@/public/screenshots/sharepoint-start-page.webp"
import shotMyTasks from "@/public/screenshots/sharepoint-my-tasks.webp"

/**
 * /sharepoint: the paid SharePoint Server extension. The add-in model, forms
 * embedded in SharePoint, list-event triggers, the REST surface, migration,
 * the on-premises gateway, extensibility, security, requirements, pricing
 * and an FAQ. Every Microsoft date on the page comes from Microsoft's own
 * pages (SOURCES), last checked on SHAREPOINT_PAGE.updated. The SharePoint
 * screens are real screenshots of SharePoint Server Subscription Edition with
 * the add-in installed (a demo "Legal" site with a Contracts library and demo
 * data), captured in the lab and kept free of lab host and account names.
 */

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

export { SHAREPOINT_PRICE }

const KB5002945 = MS.kb5002945
const SOURCES = [MS.kb5002945, MS.seDeprecated, MS.sp2013Retirement, MS.spd2013, MS.sp2016, MS.sp2019, MS.spse,
  { label: "Microsoft Lifecycle: Microsoft Workflow Manager 1.0", href: "https://learn.microsoft.com/en-us/lifecycle/products/microsoft-workflow-manager-10" },
  { label: "Microsoft Lifecycle: SharePoint Workflow Manager", href: "https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-workflow-manager" },
  MS.infopath2013, MS.powerAutomateMigration, MS.sharePointConnector, NINTEX_SE_DOCS,
]

/** Dated facts, each from the Microsoft pages in SOURCES (lib/seo/sharepoint-facts). */
const TIMELINE = SHAREPOINT_TIMELINE

const STEPS = [
  { title: "Install the add-in", body: "Run the generated PowerShell script. It registers UserTasks as a high-trust, provider-hosted add-in and publishes it to your farm's own App Catalog. No public SharePoint Store involved." },
  { title: "Click UserTasks on a list", body: "A UserTasks button appears on the ribbon and command bar of lists and libraries, with a tile in Site Contents. Single sign-on through AD FS or Windows sign-in: nobody sees a UserTasks login screen." },
  { title: "Choose what to create", body: "A full-page set-up screen that looks at home in SharePoint: the list's API reference (always), New, Edit and Display forms, and workflows. One click creates them, wired to the list." },
  { title: "Run and manage it from the list", body: "From then on the button opens \u201cUserTasks for <list>\u201d: the list's forms and workflows, its run queue, metrics and permissions, with edit, publish, turn off and run a click away." },
]

const TRIGGERS = [
  "Item created", "Item modified", "Item deleted (recycle bin or permanent)", "Renamed or moved", "Attachment added", "Attachment removed",
  "Approval status changed", "New version", "Folder created", "Restored from the recycle bin (fires Created)",
]

const REST_AREAS = [
  { icon: ListChecks, title: "Items", body: "Create, read, update, delete and query list items" },
  { icon: FolderTree, title: "Files and folders", body: "Upload, download, move, copy and rename; create and manage folders" },
  { icon: PackageCheck, title: "Versions and approval", body: "Version history, publish, approve and reject" },
  { icon: KeyRound, title: "Permissions", body: "Grant and remove access, role definitions and groups" },
  { icon: FileStack, title: "Recycle bin", body: "Restore, delete and empty" },
  { icon: Blocks, title: "Schema", body: "The list's fields and settings, refreshed when columns change" },
]

const SECURITY = [
  { title: "High-trust add-in", body: "SharePoint trusts UserTasks through a server-to-server certificate trust you register in your own farm. The add-in's permissions are listed in SharePoint and can be revoked there." },
  { title: "Follows SharePoint permissions", body: "By default, people who can manage a list in SharePoint can set up UserTasks for that list, and only that list. Checked on the server for every action. Prefer UserTasks roles only? Switch the workspace setting." },
  { title: "Silent sign-on, never a trusted username", body: "Identity comes from the identity provider SharePoint already uses (AD FS or Windows sign-in). UserTasks never accepts an unsigned username from a page." },
  { title: "Allowlists and signed requests", body: "Event callbacks and the gateway accept only allowlisted hosts and signed requests. The gateway connects out over HTTPS: no inbound firewall rules." },
  { title: "Audited", body: "Set-up actions and permission decisions are recorded in the UserTasks audit trail, which you can export to Splunk, Datadog or OpenTelemetry." },
  { title: "Reversible", body: "Restore SharePoint's original list forms at any time. Disable the extension and its data stays, ready to turn back on." },
]

const REQUIREMENTS: Array<[string, string]> = [
  ["SharePoint", "SharePoint Server 2016, 2019 or Subscription Edition (developed and tested on Subscription Edition)"],
  ["Farm services", "App Management Service and Microsoft SharePoint Foundation Subscription Settings Service, both running"],
  ["Add-ins", "An app domain for the farm and a farm App Catalog"],
  ["Sign-in", "The identity provider your farm uses, such as AD FS or Windows sign-in, for silent single sign-on"],
  ["UserTasks", "Self-hosted UserTasks in your network (production-ready), or UserTasks Cloud (in beta) through the on-premises gateway, served over HTTPS"],
  ["Gateway (cloud only)", "A Windows server that can make outbound HTTPS connections"],
]

const INCLUDED = [
  "The SharePoint add-in, for use across the farm",
  "Generated, embedded list forms and form sets",
  "All list and library triggers, push and polling",
  "The SharePoint REST surface as workflow steps and API methods",
  "InfoPath and SharePoint Designer 2010 importers, migration scan",
  "SharePoint and Active Directory directory sync",
  "The on-premises gateway for UserTasks Cloud",
  "Every update released during the year, and support",
]

const FAQS = SHAREPOINT_FAQS

/** The per-list dashboard ("UserTasks for <list>"), tab by tab, with real screenshots (demo data). */
const DASHBOARD: Array<{ id: string; tab: string; title: string; body: string; points: string[]; shot: StaticImageData; alt: string; caption: string }> = [
  {
    id: "overview", tab: "Overview", title: "Everything tied to the list, on one page",
    body: "Stat tiles for the last 7, 30 or 90 days, then the list's API reference, its forms and its workflows, each with its status and who changed it last. Create cards add what's missing.",
    points: ["Runs started, success rate, open runs, average and p95 duration, form submissions and edit conflicts", "Whether SharePoint's New, Edit and Display forms open UserTasks, with a one-click way back", "The runs waiting for someone, and who"],
    shot: shotOverview, alt: "The Overview tab of UserTasks for Contracts: six stat tiles (13 runs started, 100% succeeded, 0 failed, 4 open, 3 min average, 6 form submissions), the API reference, forms and workflow cards, and the runs waiting for people", caption: "Overview: stat tiles, the list's assets and the runs that are waiting",
  },
  {
    id: "runs", tab: "Runs", title: "A workflow queue for the list",
    body: "Every run of every workflow on the list: running, waiting on a person, queued, completed, failed or cancelled. Filter, sort, search and page through them, then open a run, cancel it or run it again.",
    points: ["Filter by status, workflow, who started it and date range", "Search by item, run ID or person", "The current step and who it is waiting for, with the due date"],
    shot: shotRuns, alt: "The Runs tab of UserTasks for Contracts: a workflow queue with status filters, search, workflow, started-by and date filters, and eight Contracts workflow runs, some completed and some waiting on a legal review or finance approval", caption: "Runs: the list's workflow queue with filters, search and actions",
  },
  {
    id: "metrics", tab: "Metrics", title: "Metrics for every workflow and form on the list",
    body: "See how the list's processes really run: how many runs finish and how long they take, where they wait and for whom, and how often the forms are used. Export the report as CSV.",
    points: ["Runs per day by outcome, and cycle time", "Where runs are waiting now, by step and by person", "Form submissions per day, per form", "A per-workflow report: started, completed, failed, cancelled, average and p95, with Download CSV"],
    shot: shotMetrics, alt: "The Metrics tab of UserTasks for Contracts: stat tiles, runs per day by outcome, cycle time, where runs are waiting by step (legal review 2, finance approval 2) and by person, form submissions per day, and a 30-day report with a Download CSV button", caption: "Metrics: outcomes, cycle time, where runs wait, submissions and a CSV report",
  },
  {
    id: "permissions", tab: "Permissions", title: "Who can change it, who can use it",
    body: "Only the list's managers and UserTasks admins see this tab. It shows the set-up mode, the roles and people who can change each form and workflow, who can use them, and the list's SharePoint permissions alongside.",
    points: ["Follow SharePoint permissions (default) or UserTasks roles only", "Give one person access to one form or workflow; every change is audited", "SharePoint's permissions for the list, read-only, with a link to change them in SharePoint"],
    shot: shotPermissions, alt: "The Permissions tab of UserTasks for Contracts: who can change the forms and workflows (Follow SharePoint permissions), who can use them, and the library's SharePoint permissions", caption: "Permissions: the set-up mode, grants per form and workflow, and SharePoint's permissions",
  },
]

const AIR_GAPPED_STEPS: Array<{ title: string; body: string }> = [
  { title: "Get the signed bundle", body: "One file with everything: the UserTasks images with the SharePoint extension included, the database and storage it needs, the Helm chart and Compose files, the CLI and the documentation. Every file is checksummed and signed." },
  { title: "Carry it across and verify it", body: "Copy it to the offline network however you move software today. The included script checks the signature and checksums with only a shell, OpenSSL and Docker." },
  { title: "Install with Docker or Kubernetes", body: "Load the images and start UserTasks with Docker Compose on an isolated network, or with the Helm chart on your Kubernetes cluster." },
  { title: "Install the add-in from your App Catalog", body: "Add the UserTasks add-in to your farm's App Catalog with the generated PowerShell script. No SharePoint Store and no internet connection needed." },
]

/**
 * `trialsAvailable`: the self-serve trial can be issued (the trial key is
 * configured). When it isn't, the trial calls to action become "Contact us".
 */
export function SharePointPage({ trialsAvailable = false }: { trialsAvailable?: boolean } = {}) {
  const baseUrl = publicBaseUrl()
  const path = `/${SHAREPOINT_PAGE.slug}`
  const jsonLd = [
    webPageNode(baseUrl, path, { name: SHAREPOINT_PAGE.title, description: SHAREPOINT_PAGE.description, updated: SHAREPOINT_PAGE.updated }),
    breadcrumbNode(baseUrl, [{ name: SHAREPOINT_PAGE.eyebrow, path }]),
    {
      "@type": "SoftwareApplication",
      "@id": `${baseUrl}${path}#extension`,
      name: "UserTasks SharePoint extension",
      applicationCategory: "BusinessApplication",
      operatingSystem: "SharePoint Server 2016, SharePoint Server 2019, SharePoint Server Subscription Edition",
      description: SHAREPOINT_PAGE.description,
      isPartOf: { "@id": `${baseUrl}/#software` },
      offers: {
        "@type": "Offer",
        price: "7500",
        priceCurrency: "USD",
        url: `${baseUrl}/contact`,
        priceSpecification: { "@type": "UnitPriceSpecification", price: "7500", priceCurrency: "USD", unitText: "SharePoint farm per year", billingDuration: "P1Y" },
      },
      ...(trialsAvailable ? { potentialAction: { "@type": "TryAction", name: `Start a ${SHAREPOINT_TRIAL.days}-day free trial`, target: `${baseUrl}${SHAREPOINT_TRIAL.path}` } } : {}),
    },
    howToNode("Set up UserTasks on a SharePoint list", STEPS, { description: "Install the UserTasks add-in in a SharePoint Server farm, open it from a list and create the list's forms and workflows." }),
    faqNode(FAQS),
  ]

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb="SharePoint on-premises"
          eyebrow="SharePoint Server extension"
          icon={Server}
          title={<>Keep SharePoint. <span className="mkt-gradient-text">Replace its workflows.</span></>}
          intro={<>Microsoft is removing SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition in July 2027. UserTasks is the replacement for SharePoint workflows and InfoPath forms on premises: an add-in that puts forms, workflows and approvals <strong className="text-white">right inside your lists and document libraries</strong>, for SharePoint Server 2016, 2019 and Subscription Edition.</>}
          primary={trialsAvailable ? { href: SHAREPOINT_TRIAL.path, label: `Start a ${SHAREPOINT_TRIAL.days}-day free trial` } : { href: "/contact", label: "Talk to us about your farm" }}
          secondary={{ href: SHAREPOINT_GET_STARTED.path, label: "How to get started (4 steps)" }}
          bullets={["Installed from your farm's App Catalog", "No UserTasks sign-in screen", "Production-ready self-hosted", "Updates and support included"]}
          visual={<HeroShot />}
        />


        <section id="summary" aria-labelledby="summary-title" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">In short</p>
              <h2 id="summary-title" className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">A supported replacement for SharePoint 2010 and 2013 workflows and InfoPath forms, inside SharePoint Server.</h2>
              <p className="mt-4 mkt-body text-(color:--mkt-text)">
                UserTasks for SharePoint replaces the SharePoint 2010 and 2013 workflow engines and InfoPath Forms Services on SharePoint Server 2016, 2019 and Subscription Edition. It adds a UserTasks button to every list and library: workflows start from list events, generated forms open inside the SharePoint page, and each list gets a dashboard with its runs, metrics and permissions. It costs {SHAREPOINT_PRICE.amount} USD per farm per year and is production-ready on your own servers, including air-gapped networks; UserTasks Cloud, through a gateway, is in beta.
              </p>
              <p className="mt-4 flex items-center gap-2 text-xs text-(color:--mkt-muted)">Last updated <time dateTime={SHAREPOINT_PAGE.updated}>{displayDate(SHAREPOINT_PAGE.updated)}</time></p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              {SHAREPOINT_KEY_FACTS.map((fact) => (
                <div key={fact.label} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">{fact.label}</dt>
                  <dd className="mt-1.5 text-sm leading-6 text-(color:--mkt-text)">{fact.value}{fact.source && <> <a href={fact.source.href} rel="noopener" className="text-(color:--mkt-bronze) hover:underline">Source</a></>}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="retirement" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <SectionHeading eyebrow="The problem" title="Microsoft is removing 2010 workflows and InfoPath from SharePoint Server.">
                Microsoft&apos;s notes for the November 2026 Subscription Edition update say it plainly: the July 13, 2027 public update removes SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition. Both are already out of support and turned off by default. Microsoft&apos;s advice is to migrate to a supported alternative now.
              </SectionHeading>
              <blockquote className="mt-6 rounded-xl border-l-4 border-(color:--mkt-gold) bg-(color:--mkt-white) p-4 text-sm leading-6 text-(color:--mkt-text)">
                &ldquo;{KB5002945_QUOTE}&rdquo;
                <footer className="mt-2 text-xs text-(color:--mkt-muted)">Microsoft, <a href={KB5002945.href} rel="noopener" className="text-(color:--mkt-bronze) hover:underline">KB5002945</a></footer>
              </blockquote>
              <p className="mt-6 mkt-body text-(color:--mkt-text)">
                The forms and approvals built on them still do real work. UserTasks takes over both jobs without moving your content: lists and libraries stay in SharePoint, and the processes around them run on a supported, open-source engine you can host next to the farm.
              </p>
              <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <Link href="/sharepoint-workflow-migration" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint workflow migration guide <ArrowRight size={14} aria-hidden="true" /></Link>
                <Link href="/infopath-migration-guide" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">InfoPath migration guide <ArrowRight size={14} aria-hidden="true" /></Link>
              </p>
            </div>
            <div>
              <ol className="space-y-3">
                {TIMELINE.map((fact) => (
                  <li key={fact.date} className={`grid gap-1 rounded-xl border p-4 sm:grid-cols-[8.5rem_1fr] sm:gap-4 ${fact.highlight ? "border-(color:--mkt-gold) bg-[#FFF8EC]" : "border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)"}`}>
                    <span className="font-semibold text-(color:--mkt-bronze)">{fact.date}</span>
                    <span className="text-sm leading-6 text-(color:--mkt-text)">{fact.text}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-xs leading-5 text-(color:--mkt-muted)">
                From Microsoft&apos;s own pages, listed in <a href="#sources" className="text-(color:--mkt-bronze) hover:underline">Sources</a>. SharePoint 2013 workflows remain supported on Subscription Edition with SharePoint Workflow Manager. Last checked <time dateTime={SHAREPOINT_PAGE.updated}>{displayDate(SHAREPOINT_PAGE.updated)}</time>.
              </p>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="How it works" title="A SharePoint add-in, installed from your own App Catalog.">
              UserTasks uses SharePoint&apos;s own add-in model: a high-trust, provider-hosted add-in that your farm administrator installs and controls. Site owners then set it up list by list, without leaving SharePoint.
            </SectionHeading>
            <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-6" data-reveal>
                  <span className="flex size-8 items-center justify-center rounded-full bg-(color:--mkt-ink) font-semibold text-white">{i + 1}</span>
                  <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10 grid gap-8 lg:grid-cols-2">
              <RealShot src={shotLibrary} alt="The Contracts document library in SharePoint Server with the UserTasks button in the command bar" caption="Step 2: the UserTasks button on a library's command bar" sizes="(min-width: 1152px) 540px, (min-width: 1024px) 46vw, 100vw" />
              <RealShot src={shotSetup} alt="The UserTasks set-up screen for the Contracts library: API reference, forms and a workflow, and the events that start it" caption="Step 3: the set-up screen the button opens" sizes="(min-width: 1152px) 540px, (min-width: 1024px) 46vw, 100vw" />
              <div className="lg:col-span-2">
                <RealShot src={shotDesigner} alt="The Contracts workflow in the UserTasks workflow designer, embedded in a SharePoint page: legal review, finance approval over $50,000, publish, lock permissions and notify" caption="Step 4: the Contracts workflow, edited in the UserTasks designer without leaving SharePoint" sizes="(min-width: 1152px) 1104px, 100vw" />
              </div>
            </div>
          </div>
        </section>

        <section id="forms" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <SectionHeading eyebrow="Forms" title="Forms that open inside SharePoint.">
                UserTasks generates New, Edit and Display forms from the list&apos;s columns, with inputs that feel like SharePoint&apos;s, and wires them to the list. They replace SharePoint&apos;s list forms, or the InfoPath forms that took their place.
              </SectionHeading>
              <ul className="mt-6 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
                {[
                  "Embedded in the SharePoint page, with the site's own header and navigation",
                  "Create, read and update the item, with ETag conflict protection so nobody overwrites a colleague's change",
                  "Save, Cancel and Delete item return people to the list, as SharePoint's forms do; Delete item shows only to people SharePoint lets delete it",
                  "A UserTasks form made for a list becomes its form by default; going back to SharePoint's is always one explicit click",
                  "The form and workflow designers open inside a SharePoint page, too",
                  "Rules, lookups, calculations and steps from the UserTasks form designer",
                  "Restore SharePoint's original forms at any time",
                ].map((t) => <li key={t} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{t}</li>)}
              </ul>
            </div>
            <div className="grid gap-6">
              <RealShot src={shotFormDetail} alt="The Contract intake form, a UserTasks New form, inside the Legal site's Contracts library page in SharePoint" caption="A UserTasks New form in place of the library's own form" sizes="(min-width: 1152px) 580px, (min-width: 1024px) 50vw, 100vw" />
              <RealShot src={shotDisplay} alt="The UserTasks Display form of an approved contract, embedded in SharePoint" caption="The Display form of an approved contract" sizes="(min-width: 1152px) 580px, (min-width: 1024px) 50vw, 100vw" />
            </div>
          </div>
        </section>

        <section id="dashboard" aria-labelledby="dashboard-title" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="The list dashboard" title={<span id="dashboard-title">See every workflow and form on the list.</span>}>
              Click UserTasks on a list that is set up and you get &ldquo;UserTasks for &lt;list&gt;&rdquo;: one page with everything bound to that list, how it is running, and who may change it. It looks like SharePoint&apos;s own settings pages and returns to the list in one click.
            </SectionHeading>
            <nav aria-label="Dashboard tabs" className="mt-8 flex flex-wrap gap-2 text-sm">
              {[...DASHBOARD.map((d) => ({ href: `#dashboard-${d.id}`, label: d.tab })), { href: "#start", label: "Start by hand" }, { href: "#web-parts", label: "Web parts" }].map((link) => (
                <a key={link.href} href={link.href} className="rounded-full border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) px-3.5 py-1.5 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-bronze)/50">{link.label}</a>
              ))}
            </nav>
            <div className="mt-12 space-y-16">
              {DASHBOARD.map((d, i) => (
                <article key={d.id} id={`dashboard-${d.id}`} className="grid scroll-mt-8 items-start gap-8 lg:grid-cols-[0.8fr_1.2fr]">
                  <div className={i % 2 ? "lg:order-2" : undefined}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">{d.tab}</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">{d.title}</h3>
                    <p className="mt-3 text-[15px] leading-7 text-(color:--mkt-text)">{d.body}</p>
                    <ul className="mt-4 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
                      {d.points.map((t) => <li key={t} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{t}</li>)}
                    </ul>
                  </div>
                  <RealShot src={d.shot} alt={d.alt} caption={d.caption} sizes="(min-width: 1152px) 660px, (min-width: 1024px) 58vw, 100vw" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="start" aria-labelledby="start-title" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Start by hand" title={<span id="start-title">Start a workflow from any item.</span>}>
              Not every process starts on a list event. &ldquo;Start a UserTasks workflow&rdquo; on the item menu opens a short page: pick the workflow, add a note for the run, start. The run records who started it, and the action is audited. Managers can also start a run from the dashboard.
            </SectionHeading>
            <div className="mt-10 grid items-start gap-8 lg:grid-cols-[1.35fr_1fr]">
              <RealShot src={shotStartMenu} alt="The Contracts library in modern SharePoint with an item's menu open and Start a UserTasks workflow highlighted" caption="The item menu in a modern SharePoint library" sizes="(min-width: 1152px) 620px, (min-width: 1024px) 55vw, 100vw" />
              <RealShot src={shotStartPage} alt="The Start a workflow page for a contract in the Contracts library: the workflow picker and an optional note for the run" caption="The start page: choose the workflow, add a note" sizes="(min-width: 1152px) 460px, (min-width: 1024px) 40vw, 100vw" />
            </div>
          </div>
        </section>

        <section id="web-parts" aria-labelledby="web-parts-title" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Web parts" title={<span id="web-parts-title">Tasks and forms on any SharePoint page.</span>}>
              Two web parts come with the add-in, for classic SharePoint pages. People sign in silently, and each part grows and shrinks with its content.
            </SectionHeading>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <Card icon={ListChecks} title="UserTasks – My tasks">
                The signed-in person&apos;s tasks with filters (mine, my groups, all; open or completed; due soon or overdue) and search. Approve, reject, accept, claim or open the full task without leaving the page. Can be narrowed to the workflows of one list.
              </Card>
              <Card icon={FileInput} title="UserTasks – Form">
                Any UserTasks form on a page, public or signed in, with a choice of what happens after submit: a thank-you message, a fresh form, or another page.
              </Card>
            </div>
            <div className="mt-8">
              <RealShot src={shotMyTasks} alt="The Legal site's home page in SharePoint with the UserTasks My tasks web part: a finance approval and a legal review, each with Approve and Reject buttons" caption="The My tasks web part on a team site's home page" sizes="(min-width: 1152px) 1104px, 100vw" />
            </div>
            <p className="mt-6 text-sm"><Link href="/docs/sharepoint/web-parts" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Web parts in the docs <ArrowRight size={14} aria-hidden="true" /></Link></p>
          </div>
        </section>

        <section id="triggers" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Triggers" title="Workflows that start when the list changes.">
              Every list and library event can start a workflow. Events arrive by push through remote event receivers, in about a second, and a polling fallback catches anything a push misses.
            </SectionHeading>
            <ul className="mt-10 flex flex-wrap gap-2">
              {TRIGGERS.map((t) => (
                <li key={t} className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) px-3.5 py-2 text-sm font-medium text-(color:--mkt-ink-soft)" data-reveal>
                  <Zap size={14} className="text-(color:--mkt-bronze)" aria-hidden="true" />{t}
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-3xl text-sm leading-6 text-(color:--mkt-muted)">
              The workflow receives the item and what changed, then does everything a UserTasks workflow can: approvals with outcomes, deadlines and escalation, decision tables, documents, emails, AI steps and calls to any other system. See <Link href="/workflows" className="font-semibold text-(color:--mkt-bronze) hover:underline">workflows</Link>, <Link href="/tasks-and-approvals" className="font-semibold text-(color:--mkt-bronze) hover:underline">tasks and approvals</Link> and <Link href="/docs/sharepoint/triggers" className="font-semibold text-(color:--mkt-bronze) hover:underline">every trigger event in the docs</Link>.
            </p>
          </div>
        </section>

        <section id="api" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="The full REST surface" title="All of SharePoint's REST API, as workflow steps.">
              Connect a list or library and UserTasks builds an API reference for it: every SharePoint operation as a typed method, usable as a workflow step, from the REST API, the CLI or MCP. When columns change, the reference refreshes.
            </SectionHeading>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {REST_AREAS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5" data-reveal>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(color:--mkt-sand) text-(color:--mkt-bronze)"><Icon size={18} aria-hidden="true" /></span>
                  <span><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{body}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="migration" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Migration" title="Bring the old work with you.">
              Start from what you already have rather than a blank page.
            </SectionHeading>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card icon={FileInput} title="InfoPath forms">
                Import .xsn templates: every view a form, with repeating tables, rules, validation and formulas converted where they translate. <Link href="/infopath" className="font-semibold text-(color:--mkt-bronze) hover:underline">Try the InfoPath importer</Link>.
              </Card>
              <Card icon={Workflow} title="SharePoint Designer 2010 workflows">
                A migration scan lists the workflows and forms across your sites. The importer rebuilds SharePoint Designer 2010 workflows as UserTasks workflows, ready to check and publish.
              </Card>
              <Card icon={Workflow} title="Nintex workflows">
                The free Nintex importer in UserTasks core reads .nwf and .nwp exports, previews them with a mapping report and imports them as draft workflows. With the extension, Import from Nintex runs inside the designer in SharePoint: it checks the list's columns (and adds missing ones), maps SharePoint actions such as setting item permissions, and can create the list. Actions without an equivalent come in as placeholders to rebuild. <Link href="/nintex-alternative" className="font-semibold text-(color:--mkt-bronze) hover:underline">Nintex alternative</Link>.
              </Card>
              <Card icon={Users} title="People and groups">
                Directory sync brings in SharePoint and Active Directory users and groups, so approvals go to the same people they always did.
              </Card>
            </div>
          </div>
        </section>

        <section id="gateway" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Where it runs" title="Next to your farm, or in our cloud.">
                Run UserTasks yourself in the same network as SharePoint, on Docker or Kubernetes: self-hosted UserTasks and the SharePoint extension are production-ready today. Or try UserTasks Cloud, which is in beta, and let the on-premises gateway reach the farm for you.
              </SectionHeading>
              <p className="mt-6 text-sm">
                <Link href="/deploy-anywhere" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Deployment options <ArrowRight size={14} aria-hidden="true" /></Link>
              </p>
            </div>
            <div className="grid gap-4">
              <Card icon={Building2} title={<>Self-hosted <ProductionReadyBadge /></>}>
                UserTasks runs inside your network and talks to SharePoint directly. Nothing leaves your data centre.
              </Card>
              <Card icon={Cloud} title={<>UserTasks Cloud, through the gateway <BetaBadge /></>}>
                A small Windows service on your network connects out over HTTPS. No inbound firewall rules; only allowlisted SharePoint addresses; every request signed.
              </Card>
            </div>
          </div>
        </section>

        <section id="air-gapped" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Air-gapped networks" title="Runs fully on-premises, with no internet at all.">
                Many SharePoint farms sit on networks that can&apos;t reach the internet. UserTasks is built for that: nothing calls out at runtime (no SaaS, CDN or telemetry), and our release checks prove the whole install on a host with no internet access.
              </SectionHeading>
              <p className="mt-6 text-sm">
                <Link href="/docs/self-hosting/air-gapped" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Air-gapped install guide <ArrowRight size={14} aria-hidden="true" /></Link>
              </p>
            </div>
            <ol className="grid gap-4">
              {AIR_GAPPED_STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5" data-reveal>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-bronze)/10 text-sm font-semibold text-(color:--mkt-bronze)" aria-hidden="true">{i + 1}</span>
                  <span>
                    <span className="block font-semibold">{step.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{step.body}</span>
                  </span>
                </li>
              ))}
              <li className="flex items-start gap-3 rounded-2xl border border-dashed border-(color:--mkt-ink)/15 p-5 text-sm leading-6 text-(color:--mkt-text)">
                <WifiOff size={18} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />
                <span>Your SharePoint licence is checked offline from a signed licence file, so the extension never needs to phone home. Sign-in works with AD FS, Kerberos or UserTasks&apos; own accounts, and AI steps can use models you host yourself.</span>
              </li>
            </ol>
          </div>
        </section>

        <section id="extensibility" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Extensibility" title="Open at the core, and yours to extend.">
              UserTasks is open source under Apache-2.0, built on an open extension framework. The SharePoint extension is one extension on it, and everything it creates is reachable the same ways as the rest of UserTasks.
            </SectionHeading>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { icon: Blocks, title: "Extension framework", body: "Build your own extensions with the SDK", href: "/docs/developers/extensions" },
                { icon: Code2, title: "REST API", body: "Every operation, with OpenAPI", href: "/docs/api" },
                { icon: MousePointerClick, title: "CLI", body: "Script set-up and deployments", href: "/docs/cli" },
                { icon: Network, title: "MCP", body: "Let AI assistants build and run", href: "/docs/api" },
                { icon: FileStack, title: "Config as code", body: "Review forms and workflows in Git", href: "/docs/cli" },
              ].map(({ icon: Icon, title, body, href }) => (
                <li key={title}>
                  <Link href={href} className="block h-full rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5 hover:border-(color:--mkt-bronze)/40" data-reveal>
                    <Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                    <span className="mt-3 block font-semibold">{title}</span>
                    <span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{body}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm"><Link href="/open-source" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">UserTasks is open source <ArrowRight size={14} aria-hidden="true" /></Link></p>
          </div>
        </section>

        <section id="security" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Security" title="Built for the people who run the farm." />
            <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {SECURITY.map((item) => (
                <li key={item.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6" data-reveal>
                  <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={17} className="text-(color:--mkt-bronze)" aria-hidden="true" />{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="requirements" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Requirements" title="What your farm needs." />
            <div className="mt-10 overflow-hidden rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)">
              <table className="w-full text-left text-sm">
                <tbody>
                  {REQUIREMENTS.map(([what, need], i) => (
                    <tr key={what} className={`${i ? "border-t border-(color:--mkt-ink)/[0.06]" : ""} align-top`}>
                      <th scope="row" className="w-40 px-4 py-3 font-semibold sm:w-56">{what}</th>
                      <td className="px-4 py-3 text-(color:--mkt-text)">{need}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="compare" aria-labelledby="compare-title" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Your options" title={<span id="compare-title">{ALTERNATIVES_COMPARISON.title}</span>}>{ALTERNATIVES_COMPARISON.body}</SectionHeading>
            <div className="mt-10 overflow-x-auto rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="bg-(color:--mkt-sand) text-xs uppercase tracking-wider text-(color:--mkt-muted)">
                  <tr>{ALTERNATIVES_COMPARISON.columns.map((column, index) => <th key={index} scope="col" className="px-4 py-3 align-bottom">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {ALTERNATIVES_COMPARISON.rows.map((row) => (
                    <tr key={row[0]} className="border-t border-(color:--mkt-ink)/[0.06] align-top">
                      {row.map((cell, index) => index === 0
                        ? <th key={index} scope="row" className="px-4 py-3 font-semibold">{cell}</th>
                        : <td key={index} className="px-4 py-3 leading-6 text-(color:--mkt-text)">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs leading-5 text-(color:--mkt-muted)">{ALTERNATIVES_COMPARISON.note} Checked <time dateTime={SHAREPOINT_PAGE.updated}>{displayDate(SHAREPOINT_PAGE.updated)}</time>; see <a href="#sources" className="text-(color:--mkt-bronze) hover:underline">Sources</a>.</p>
            <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/nintex-alternative" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Nintex alternative for SharePoint on premises <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/sharepoint-workflow-migration" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint workflow migration guide <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Pricing" title="One price per farm. Everything included." align="center" />
            <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-3xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) shadow-[0_30px_80px_-40px_rgba(16,14,11,0.35)]">
              <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">SharePoint extension</p>
                  <p className="mt-3 font-display text-5xl font-bold tracking-tight">{SHAREPOINT_PRICE.amount}<span className="ml-1 text-lg font-semibold text-(color:--mkt-muted)">{SHAREPOINT_PRICE.currency}</span></p>
                  <p className="mt-2 text-sm text-(color:--mkt-text)">{SHAREPOINT_PRICE.unit}, including {SHAREPOINT_PRICE.includes}.</p>
                  {trialsAvailable ? (
                    <>
                      <Link href={SHAREPOINT_TRIAL.path} className="mkt-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold" data-testid="pricing-trial">Start a {SHAREPOINT_TRIAL.days}-day free trial <ArrowRight size={16} aria-hidden="true" /></Link>
                      <Link href="/contact" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-(color:--mkt-ink)/[0.12] px-5 py-3 text-sm font-semibold">Buy or ask a question</Link>
                      <p className="mt-3 text-xs leading-5 text-(color:--mkt-muted)">Free for {SHAREPOINT_TRIAL.days} days on one farm, no card. Self-hosted UserTasks is production-ready; UserTasks Cloud is in beta.</p>
                    </>
                  ) : (
                    <Link href="/contact" className="mkt-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold">Contact us to get started <ArrowRight size={16} aria-hidden="true" /></Link>
                  )}
                  <Link href={SHAREPOINT_GET_STARTED.path} className="mt-3 inline-flex w-full items-center justify-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline" data-testid="pricing-get-started">How to get started, step by step <ArrowRight size={14} aria-hidden="true" /></Link>
                  <p className="mt-3 text-xs leading-5 text-(color:--mkt-muted)">UserTasks itself is open source and free to self-host. The SharePoint extension is the paid part.</p>
                </div>
                <ul className="space-y-2 text-sm leading-6 text-(color:--mkt-text)">
                  {INCLUDED.map((t) => <li key={t} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{t}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="FAQ" title="Questions SharePoint admins ask." />
            <div className="mt-10 space-y-3">
              {FAQS.map((faq) => (
                <details key={faq.question} className="group rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-5">
                  <summary className="cursor-pointer list-none"><h3 className="inline font-semibold">{faq.question}</h3></summary>
                  <p className="mt-3 text-sm leading-7 text-(color:--mkt-muted)">{faq.answer}</p>
                </details>
              ))}
            </div>

            <div id="sources" className="mt-12 scroll-mt-8">
              <h2 className="text-lg font-semibold">Sources</h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {SOURCES.map((source) => <li key={source.href}><a href={source.href} rel="noopener" className="text-(color:--mkt-bronze) hover:underline">{source.label}</a></li>)}
              </ul>
              <p className="mt-3 text-xs text-(color:--mkt-muted)">Last checked <time dateTime={SHAREPOINT_PAGE.updated}>{displayDate(SHAREPOINT_PAGE.updated)}</time>. The SharePoint screens on this page are real SharePoint Server Subscription Edition screens with demo data.</p>
            </div>

            <p className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/docs/sharepoint" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint extension docs <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/infopath" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Migrate from InfoPath <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/infopath-migration-guide" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">InfoPath migration guide <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/nintex-alternative" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Nintex alternative <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/use-cases/sharepoint-workflow-replacement" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint workflow replacement architecture <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/sharepoint-workflow-migration" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint workflow migration <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/on-premises-workflow-automation" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">On-premises workflow automation <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/contact" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Contact us <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
            <p className="mt-8 text-xs leading-5 text-(color:--mkt-muted)">
              UserTasks is an independent open-source project and is not affiliated with or endorsed by Microsoft. SharePoint, SharePoint Designer, InfoPath, Power Automate and Active Directory are trademarks of the Microsoft group of companies. Nintex is a trademark of its owner.
            </p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}

function Card({ icon: Icon, title, children }: { icon: typeof Lock; title: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6" data-reveal>
      <h3 className="flex items-center gap-2 text-lg font-semibold"><Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />{title}</h3>
      <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{children}</p>
    </div>
  )
}

const REAL_NOTE = "Real SharePoint Server Subscription Edition screens with demo data."

/** The hero: the intake form embedded in the SharePoint page (the most important screen). */
function HeroShot() {
  return (
    <figure className="mkt-glow">
      <ScreenshotFrame>
        <Image src={shotForm} alt="A UserTasks form embedded in a SharePoint Server page: the Contract intake form in the Legal site's Contracts library, with SharePoint's suite bar, site header and navigation around it" sizes="(min-width: 1152px) 1104px, 100vw" loading="eager" fetchPriority="high" placeholder="blur" className="h-auto w-full" />
      </ScreenshotFrame>
      <figcaption className="mt-3 text-center text-xs text-[#A89E8C]">A UserTasks form embedded in a SharePoint Server page. {REAL_NOTE}</figcaption>
    </figure>
  )
}

/** A real SharePoint screenshot below the fold (lazy-loaded by next/image). */
function RealShot({ src, alt, caption, sizes }: { src: StaticImageData; alt: string; caption: string; sizes: string }) {
  return (
    <figure data-reveal>
      <ScreenshotFrame>
        <Image src={src} alt={alt} sizes={sizes} placeholder="blur" className="h-auto w-full" />
      </ScreenshotFrame>
      <figcaption className="mt-2 text-center text-xs text-(color:--mkt-muted)">{caption} (real screen, demo data).</figcaption>
    </figure>
  )
}
