import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowRight, Blocks, Building2, Check, Cloud, Code2, FileInput, FileStack, FolderTree, KeyRound, ListChecks, Lock, MousePointerClick, Network,
  PackageCheck, Server, ShieldCheck, Users, Workflow, Zap, WifiOff,
} from "lucide-react"
import { LogoMark } from "@/components/brand/logo"
import { ProductHero } from "@/components/marketing/product-hero"
import { MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/marketing-ui"
import { SHAREPOINT_PAGE } from "@/lib/marketing-pages"
import { publicBaseUrl } from "@/lib/deployment"
import { breadcrumbNode, displayDate, faqNode, howToNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"

/**
 * /sharepoint: the paid SharePoint Server extension. The add-in model, forms
 * embedded in SharePoint, list-event triggers, the REST surface, migration,
 * the on-premises gateway, extensibility, security, requirements, pricing
 * and an FAQ. Every Microsoft date on the page comes from Microsoft's own
 * pages (SOURCES), last checked on SHAREPOINT_PAGE.updated. The SharePoint
 * screens are illustrations built from site components, not screenshots.
 */

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

export const SHAREPOINT_PRICE = { amount: "$7,500", currency: "USD", unit: "per SharePoint farm, per year", includes: "updates and support" }

const KB5002945 = { label: "Microsoft Support: Security update for SharePoint Server Subscription Edition, November 10, 2026 (KB5002945)", href: "https://support.microsoft.com/en-us/servicing/office/hotfix/sharepoint/5002945" }
const SOURCES = [
  KB5002945,
  { label: "Microsoft Learn: What's deprecated or removed from SharePoint Server Subscription Edition", href: "https://learn.microsoft.com/en-us/sharepoint/what-s-new/what-s-deprecated-or-removed-from-sharepoint-server-subscription-edition" },
  { label: "Microsoft Support: SharePoint 2013 workflow retirement", href: "https://support.microsoft.com/en-us/office/sharepoint-2013-workflow-retirement-4613d9cf-69aa-40f7-b6bf-6e7831c9691e" },
  { label: "Microsoft Lifecycle: SharePoint Server 2016", href: "https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-server-2016" },
  { label: "Microsoft Lifecycle: SharePoint Server 2019", href: "https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-server-2019" },
  { label: "Microsoft Lifecycle: SharePoint Server Subscription Edition", href: "https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-server-subscription-edition" },
  { label: "Microsoft Lifecycle: Microsoft Workflow Manager 1.0", href: "https://learn.microsoft.com/en-us/lifecycle/products/microsoft-workflow-manager-10" },
  { label: "Microsoft Lifecycle: SharePoint Workflow Manager", href: "https://learn.microsoft.com/en-us/lifecycle/products/sharepoint-workflow-manager" },
  { label: "Microsoft Lifecycle: InfoPath 2013", href: "https://learn.microsoft.com/en-us/lifecycle/products/infopath-2013" },
]

/** Dated facts, each from the Microsoft pages in SOURCES. */
const TIMELINE = [
  { date: "November 1, 2020", text: "SharePoint 2010 workflows retired in SharePoint Online." },
  { date: "April 2, 2026", text: "SharePoint 2013 workflows fully retired in SharePoint Online, with no option to extend." },
  { date: "July 14, 2026", text: "SharePoint Server 2016 and 2019, SharePoint Designer 2013 and InfoPath 2013 reached the end of extended support. Support for SharePoint 2010 workflows and InfoPath Forms Services in Subscription Edition ended, and so did support for the classic Microsoft Workflow Manager as a SharePoint component." },
  { date: "September 2026", text: "SharePoint 2010 workflows and InfoPath Forms Services turned off by default in Subscription Edition, from that month's public update." },
  { date: "July 13, 2027", text: "The public update removes SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition.", highlight: true },
]

const STEPS = [
  { title: "Install the add-in", body: "Run the generated PowerShell script. It registers UserTasks as a high-trust, provider-hosted add-in and publishes it to your farm's own App Catalog. No public SharePoint Store involved." },
  { title: "Click UserTasks on a list", body: "A UserTasks button appears on the ribbon and command bar of lists and libraries, with a tile in Site Contents. Single sign-on through AD FS or Windows sign-in: nobody sees a UserTasks login screen." },
  { title: "Choose what to create", body: "A full-page set-up screen that looks at home in SharePoint: the list's API reference (always), New, Edit and Display forms, and workflows. One click creates them, wired to the list." },
  { title: "Run and manage it from the list", body: "From then on the button opens a page for that list: its forms, workflows, recent runs and stats, with edit, publish, disable and run a click away." },
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
  ["UserTasks", "Self-hosted UserTasks in your network, or UserTasks Cloud through the on-premises gateway, served over HTTPS"],
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

const FAQS = [
  { question: "What is the UserTasks SharePoint extension?", answer: "It is a paid extension for UserTasks, the open-source forms and workflow platform, that connects it to SharePoint Server 2016, 2019 and Subscription Edition. A provider-hosted add-in puts a UserTasks button on your lists, generates forms that open inside SharePoint, starts workflows from list events, exposes the SharePoint REST API as workflow steps and imports InfoPath and SharePoint Designer 2010 work." },
  { question: "Is Microsoft removing workflows from SharePoint Server?", answer: "Yes, for SharePoint 2010 workflows. Microsoft's notes for the November 10, 2026 Subscription Edition update (KB5002945) say the July 13, 2027 public update removes SharePoint 2010 workflows and InfoPath Forms Services from Subscription Edition. Both reached end of support on July 14, 2026 and have been turned off by default since the September 2026 public update. Microsoft advises anyone still using them to migrate now." },
  { question: "What about SharePoint 2013 workflows?", answer: "On Subscription Edition, Microsoft still supports SharePoint 2013 workflows with SharePoint Workflow Manager, which follows the support timeline of SharePoint Server. They are already retired in SharePoint Online (April 2, 2026), SharePoint Designer 2013 left support on July 14, 2026, and the classic Microsoft Workflow Manager's support as a SharePoint component ended the same day. Many teams move them together with their 2010 workflows." },
  { question: "Which SharePoint versions does it support?", answer: "SharePoint Server 2016, SharePoint Server 2019 and SharePoint Server Subscription Edition. It is developed and tested on Subscription Edition. Note that Microsoft ended extended support for SharePoint Server 2016 and 2019 on July 14, 2026; Subscription Edition follows Microsoft's Modern Lifecycle Policy and is in support." },
  { question: "Do people have to sign in to UserTasks?", answer: "No. Clicking UserTasks in SharePoint signs people in silently through the identity provider SharePoint already uses, such as AD FS or Windows sign-in. They never see a UserTasks login screen, and forms open inside the SharePoint page with the site's own header and navigation." },
  { question: "Do we need the SharePoint Store or internet access?", answer: "No. The add-in is installed from your farm's own App Catalog with a generated PowerShell script. With self-hosted UserTasks everything stays in your network. With UserTasks Cloud, a small Windows gateway makes outbound-only HTTPS connections, so you open no inbound firewall ports." },
  { question: "Can it run on an air-gapped network?", answer: "Yes. UserTasks makes no outbound calls at runtime (no SaaS, CDN or telemetry). You receive one signed bundle with the UserTasks images (SharePoint extension included), the database and storage it needs, the Helm chart, Docker Compose files, the CLI and the documentation. Verify it, carry it across, and install with Docker Compose or Kubernetes. The SharePoint licence is checked offline from a signed licence file, and the add-in installs from your farm's App Catalog. Our release checks prove the full install on a host with no internet access." },
  { question: "Can we go back to SharePoint's original forms?", answer: "Yes. Generated UserTasks forms replace a list's New, Edit and Display forms, whether they were SharePoint's own or InfoPath forms, and you can restore the originals at any time. Save, Delete and Cancel on a UserTasks form return people to the list, just as before, so switching back and forth is painless." },
  { question: "How much does it cost?", answer: "$7,500 USD per SharePoint farm per year, including every update released during the year and support. UserTasks itself is open source under Apache-2.0; the SharePoint extension is the paid part. Contact us to get a licence or to plan a trial on your farm." },
]

const AIR_GAPPED_STEPS: Array<{ title: string; body: string }> = [
  { title: "Get the signed bundle", body: "One file with everything: the UserTasks images with the SharePoint extension included, the database and storage it needs, the Helm chart and Compose files, the CLI and the documentation. Every file is checksummed and signed." },
  { title: "Carry it across and verify it", body: "Copy it to the offline network however you move software today. The included script checks the signature and checksums with only a shell, OpenSSL and Docker." },
  { title: "Install with Docker or Kubernetes", body: "Load the images and start UserTasks with Docker Compose on an isolated network, or with the Helm chart on your Kubernetes cluster." },
  { title: "Install the add-in from your App Catalog", body: "Add the UserTasks add-in to your farm's App Catalog with the generated PowerShell script. No SharePoint Store and no internet connection needed." },
]

export function SharePointPage() {
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
          primary={{ href: "/contact", label: "Talk to us about your farm" }}
          secondary={{ href: "#pricing", label: `${SHAREPOINT_PRICE.amount} per farm per year` }}
          bullets={["Installed from your farm's App Catalog", "No UserTasks sign-in screen", "Self-hosted or UserTasks Cloud", "Updates and support included"]}
          visual={<SetupIllustration />}
        />

        <section id="retirement" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <SectionHeading eyebrow="The problem" title="Microsoft is removing 2010 workflows and InfoPath from SharePoint Server.">
                Microsoft&apos;s notes for the November 2026 Subscription Edition update say it plainly: the July 13, 2027 public update removes SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition. Both are already out of support and turned off by default. Microsoft&apos;s advice is to migrate to a supported alternative now.
              </SectionHeading>
              <blockquote className="mt-6 rounded-xl border-l-4 border-(color:--mkt-gold) bg-(color:--mkt-white) p-4 text-sm leading-6 text-(color:--mkt-text)">
                &ldquo;The July 13, 2027, public update removes Microsoft SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition.&rdquo;
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
                  "Save, Delete or Cancel returns people to the list",
                  "Rules, lookups, calculations and steps from the UserTasks form designer",
                  "Restore SharePoint's original forms at any time",
                ].map((t) => <li key={t} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{t}</li>)}
              </ul>
            </div>
            <FormIllustration />
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
              The workflow receives the item and what changed, then does everything a UserTasks workflow can: approvals with outcomes, deadlines and escalation, decision tables, documents, emails, AI steps and calls to any other system. See <Link href="/workflows" className="font-semibold text-(color:--mkt-bronze) hover:underline">workflows</Link> and <Link href="/tasks-and-approvals" className="font-semibold text-(color:--mkt-bronze) hover:underline">tasks and approvals</Link>.
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
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <Card icon={FileInput} title="InfoPath forms">
                Import .xsn templates: every view a form, with repeating tables, rules, validation and formulas converted where they translate. <Link href="/infopath" className="font-semibold text-(color:--mkt-bronze) hover:underline">Try the InfoPath importer</Link>.
              </Card>
              <Card icon={Workflow} title="SharePoint Designer 2010 workflows">
                A migration scan lists the workflows and forms across your sites. The importer rebuilds SharePoint Designer 2010 workflows as UserTasks workflows, ready to check and publish.
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
                Run UserTasks yourself in the same network as SharePoint, on Docker or Kubernetes. Or use UserTasks Cloud and let the on-premises gateway reach the farm for you.
              </SectionHeading>
              <p className="mt-6 text-sm">
                <Link href="/deploy-anywhere" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Deployment options <ArrowRight size={14} aria-hidden="true" /></Link>
              </p>
            </div>
            <div className="grid gap-4">
              <Card icon={Building2} title="Self-hosted">
                UserTasks runs inside your network and talks to SharePoint directly. Nothing leaves your data centre.
              </Card>
              <Card icon={Cloud} title="UserTasks Cloud, through the gateway">
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

        <section id="pricing" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Pricing" title="One price per farm. Everything included." align="center" />
            <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-3xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) shadow-[0_30px_80px_-40px_rgba(16,14,11,0.35)]">
              <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">SharePoint extension</p>
                  <p className="mt-3 font-display text-5xl font-bold tracking-tight">{SHAREPOINT_PRICE.amount}<span className="ml-1 text-lg font-semibold text-(color:--mkt-muted)">{SHAREPOINT_PRICE.currency}</span></p>
                  <p className="mt-2 text-sm text-(color:--mkt-text)">{SHAREPOINT_PRICE.unit}, including {SHAREPOINT_PRICE.includes}.</p>
                  <Link href="/contact" className="mkt-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold">Contact us to get started <ArrowRight size={16} aria-hidden="true" /></Link>
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
              <p className="mt-3 text-xs text-(color:--mkt-muted)">Last checked <time dateTime={SHAREPOINT_PAGE.updated}>{displayDate(SHAREPOINT_PAGE.updated)}</time>. The SharePoint screens on this page are illustrations.</p>
            </div>

            <p className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/infopath" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Migrate from InfoPath <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/sharepoint-workflow-migration" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint workflow migration <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/on-premises-workflow-automation" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">On-premises workflow automation <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/contact" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Contact us <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
            <p className="mt-8 text-xs leading-5 text-(color:--mkt-muted)">
              UserTasks is an independent open-source project and is not affiliated with or endorsed by Microsoft. SharePoint, InfoPath and Active Directory are trademarks of the Microsoft group of companies.
            </p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}

function Card({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6" data-reveal>
      <h3 className="flex items-center gap-2 text-lg font-semibold"><Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />{title}</h3>
      <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{children}</p>
    </div>
  )
}

/** A generic team-site frame (no Microsoft branding): site bar, title and navigation. */
function SiteFrame({ children, crumb }: { children: ReactNode; crumb: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-(color:--mkt-white) text-(color:--mkt-ink) shadow-[0_40px_100px_-30px_rgba(0,0,0,0.6)]">
      <div className="flex items-center gap-3 bg-[#2B3A55] px-4 py-2 text-xs text-white/85">
        <span className="font-semibold text-white">Intranet</span>
        <span className="hidden text-white/50 sm:inline">|</span>
        <span className="hidden sm:inline">Finance team site</span>
        <span className="ml-auto flex size-6 items-center justify-center rounded-full bg-[#fff]/20 text-[10px] font-semibold">JD</span>
      </div>
      <div className="flex items-center gap-3 border-b border-(color:--mkt-line) px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-md bg-[#3B6E8F] text-xs font-bold text-white">FT</span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Finance team site</span>
          <span className="block truncate text-[11px] text-(color:--mkt-muted)">Home · Documents · {crumb}</span>
        </span>
      </div>
      {children}
    </div>
  )
}

/** Illustration: the UserTasks button on a list's command bar and the first-time set-up screen. */
function SetupIllustration() {
  const rows = [
    ["Laptop for new starter", "$1,250.00", "Pending"],
    ["Conference travel", "$2,480.00", "Approved"],
    ["Office chairs (6)", "$1,914.00", "Pending"],
  ]
  return (
    <figure className="mkt-glow" aria-label="Illustration: the UserTasks button on a SharePoint list and the set-up screen it opens">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <SiteFrame crumb="Purchase requests">
          <div className="flex flex-wrap items-center gap-1 border-b border-(color:--mkt-line) bg-(color:--mkt-canvas) px-3 py-2 text-xs">
            <span className="rounded px-2 py-1 text-(color:--mkt-text)">+ New</span>
            <span className="rounded px-2 py-1 text-(color:--mkt-text)">Edit in grid view</span>
            <span className="rounded px-2 py-1 text-(color:--mkt-text)">Share</span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-(color:--mkt-white) px-2 py-1 font-semibold text-(color:--mkt-ink) shadow-[0_0_0_2px_var(--mkt-gold)]">
              <LogoMark size={14} /> UserTasks
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="text-base font-semibold">Purchase requests</p>
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-(color:--mkt-muted)"><tr><th className="py-1.5 font-medium">Title</th><th className="py-1.5 font-medium">Amount</th><th className="py-1.5 font-medium">Status</th></tr></thead>
              <tbody>
                {rows.map(([title, amount, status]) => (
                  <tr key={title} className="border-t border-(color:--mkt-line)">
                    <td className="py-2 pr-2 text-[#2B5C8A]">{title}</td>
                    <td className="py-2 pr-2 tabular-nums">{amount}</td>
                    <td className="py-2">{status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SiteFrame>
        <div className="rounded-2xl border border-white/10 bg-(color:--mkt-white) p-5 text-(color:--mkt-ink) shadow-[0_40px_100px_-30px_rgba(0,0,0,0.6)]">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)"><LogoMark size={16} /> Set up UserTasks</p>
          <p className="mt-2 font-display text-xl font-bold">Purchase requests</p>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              { title: "API reference", body: "Every SharePoint operation for this list", locked: true },
              { title: "Forms", body: "New, Edit and Display, replacing the list's forms", locked: false },
              { title: "Workflow", body: "When an item is created: approval by the budget owner", locked: false },
            ].map((item) => (
              <li key={item.title} className="flex items-start gap-3 rounded-xl border border-(color:--mkt-line) p-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-(color:--mkt-ink) text-white"><Check size={13} aria-hidden="true" /></span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-semibold">{item.title}{item.locked && <Lock size={12} className="text-(color:--mkt-muted)" aria-label="always on" />}</span>
                  <span className="block text-xs leading-5 text-(color:--mkt-muted)">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <span className="mkt-btn-primary mt-4 flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold">Create</span>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-[#A89E8C]">Illustration</figcaption>
    </figure>
  )
}

/** Illustration: a generated New form embedded in the SharePoint page. */
function FormIllustration() {
  const field = (label: string, value: string, hint?: string) => (
    <div key={label}>
      <span className="block text-xs font-semibold text-(color:--mkt-ink-soft)">{label}</span>
      <span className="mt-1 block rounded border border-(color:--mkt-line-strong) bg-(color:--mkt-white) px-2.5 py-1.5 text-sm">{value}</span>
      {hint && <span className="mt-0.5 block text-[11px] text-(color:--mkt-muted)">{hint}</span>}
    </div>
  )
  return (
    <figure className="mkt-glow" data-reveal aria-label="Illustration: a UserTasks New item form inside a SharePoint site">
      <SiteFrame crumb="Purchase requests › New item">
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {field("Title *", "Laptop for new starter")}
          {field("Amount *", "$1,250.00", "USD")}
          {field("Department", "Finance ▾")}
          {field("Budget owner", "Jordan Diaz")}
          <div className="sm:col-span-2">{field("Justification", "Replacement for a five-year-old machine")}</div>
        </div>
        <div className="flex items-center gap-2 border-t border-(color:--mkt-line) px-5 py-3">
          <span className="rounded bg-[#2B5C8A] px-4 py-1.5 text-sm font-semibold text-white">Save</span>
          <span className="rounded border border-(color:--mkt-line-strong) px-4 py-1.5 text-sm">Cancel</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-(color:--mkt-muted)"><LogoMark size={12} /> Form by UserTasks</span>
        </div>
      </SiteFrame>
      <figcaption className="mt-3 text-center text-xs text-(color:--mkt-muted)">Illustration</figcaption>
    </figure>
  )
}
