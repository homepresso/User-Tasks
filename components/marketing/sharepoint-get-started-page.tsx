import type { ReactNode } from "react"
import Link from "next/link"
import Image, { type StaticImageData } from "next/image"
import { ArrowRight, Clock, Download, MousePointerClick, PlugZap, Rocket } from "lucide-react"
import { ScreenshotFrame } from "@/components/marketing/screenshot-frame"
import { BetaBadge, FaqList, InlineCode, MarketingFooter, MarketingHeader, ProductionReadyBadge, Snippet } from "@/components/marketing/marketing-ui"
import { publicBaseUrl } from "@/lib/deployment"
import { breadcrumbNode, faqNode, howToNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"
import { SHAREPOINT_GET_STARTED, SHAREPOINT_PRICE, SHAREPOINT_TRIAL, SUPPORTED_VERSIONS } from "@/lib/seo/sharepoint-facts"
import shotSetup from "@/public/screenshots/sharepoint-setup.webp"
import shotLibrary from "@/public/screenshots/sharepoint-library-button.webp"
import shotForm from "@/public/screenshots/sharepoint-form-embedded.webp"
import shotOverview from "@/public/screenshots/sharepoint-dashboard-overview.webp"
import shotMyTasks from "@/public/screenshots/sharepoint-my-tasks.webp"

/**
 * /sharepoint/get-started: from the free trial to the first SharePoint form
 * and workflow, in four steps. Every command and screen name here matches
 * the real installers (deploy/install/install.ps1, install.sh), the setup
 * code screen, Settings → Licence / Extensions, the generated add-in install
 * script and the public SharePoint docs (lib/docs/content/sharepoint.ts).
 */

/** Same commands as /install (components/marketing/install-page.tsx). */
export const INSTALL_PS1 = "irm https://usertasks.com/install.ps1 | iex"
export const INSTALL_SH = "curl -fsSL https://usertasks.com/install.sh | sh"
export const FARM_ID_COMMAND = "(Get-SPFarm).Id"
export const REALM_COMMAND = "Get-SPAuthenticationRealm"
export const INSTALL_PS1_URL = "& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Url https://usertasks.corp.example"
/** The licence file from step 1 (the trial e-mail names it after the farm ID; this matches the example farm ID). */
export const TRIAL_LICENCE_FILE = "usertasks-sharepoint-trial-3f2504e0.licence"
/**
 * The SharePoint edition: the same installers with --edition and the licence.
 * Literal snippet constants (the snippet checks read them from this file);
 * a test keeps them equal to lib/editions/catalog.ts.
 */
export const EDITION_INSTALL_PS1 = "& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Edition sharepoint -Licence .\\usertasks-sharepoint-trial-3f2504e0.licence"
export const EDITION_INSTALL_PS1_URL = "& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Edition sharepoint -Licence .\\usertasks-sharepoint-trial-3f2504e0.licence -Url https://usertasks.corp.example"
export const EDITION_INSTALL_SH = "curl -fsSL https://usertasks.com/install.sh | sh -s -- --edition sharepoint --licence usertasks-sharepoint-trial-3f2504e0.licence"
export const EDITION_SWITCH_SH = "usertasks upgrade --edition sharepoint"
export const EDITION_BUNDLE_SH = "curl -fsSL https://usertasks.com/install.sh | sh -s -- --bundle-download --edition sharepoint --licence usertasks-sharepoint-trial-3f2504e0.licence"
export const ADDIN_COMMAND = ".\\Install-UserTasksAddin.ps1 -SiteUrls https://sharepoint.corp.example/sites/finance,https://sharepoint.corp.example/sites/hr"
export const OPENSSL_COMMAND = 'openssl req -x509 -newkey rsa:2048 -nodes -keyout usertasks-addin.key -out usertasks-addin.crt -days 730 -subj "/CN=UserTasks add-in"'

export const GET_STARTED_STEPS: Array<{ title: string; time: string; body: string }> = [
  { title: "Start your free trial", time: "2 minutes", body: "Find your farm ID with (Get-SPFarm).Id in the SharePoint Management Shell, then fill in the trial form with your name, work email and company. You get a signed 30-day licence for that farm at once, on screen and by email." },
  { title: "Install UserTasks, the fastest way", time: "15 minutes", body: "On a Windows machine with Docker Desktop, or a Linux server with Docker, that can reach the farm, run the one-line installer with --edition sharepoint and your licence file. It checks the licence with usertasks.com, downloads the SharePoint edition of UserTasks and installs the licence. Open the address it prints, enter the setup code to create your admin account, then turn on SharePoint in Settings → Extensions." },
  { title: "Connect SharePoint", time: "20 minutes", body: "Allow the farm's addresses, create the SharePoint Server connection and connect a site. In Settings → Integrations → SharePoint add-in enter the client ID, issuer ID and certificate, download the add-in package and Install-UserTasksAddin.ps1, and have a farm administrator run it with -SiteUrls." },
  { title: "Get going", time: "10 minutes", body: "Click UserTasks on a list, create its forms and a workflow in one go, and the generated forms replace SharePoint's. The UserTasks button then opens the list dashboard. Import InfoPath forms or SharePoint Designer 2010 workflows, and add the My tasks web part to a page." },
]

export const GET_STARTED_FAQS: Array<{ question: string; answer: string }> = [
  { question: "Which SharePoint versions does UserTasks support?", answer: `${SUPPORTED_VERSIONS}, on premises. It is developed and tested on Subscription Edition. The farm needs the App Management Service and the Microsoft SharePoint Foundation Subscription Settings Service running, an app domain and a farm App Catalog.` },
  { question: "Where should I install UserTasks?", answer: "On a machine next to the farm, not on a SharePoint server: a Linux server with Docker, or a Windows machine with Docker Desktop (WSL 2 backend, Linux containers). It needs about 2 GB of memory for the containers (4 GB or more recommended) and 5 GB of disk, and an HTTPS address that SharePoint and your users can reach. Air-gapped networks are supported with the signed offline bundle." },
  { question: "Is self-hosted UserTasks ready for production?", answer: "Yes. Self-hosted UserTasks and the SharePoint extension are production-ready. UserTasks Cloud, which reaches the farm through an outbound-only gateway, is in beta." },
  { question: "What happens when the trial ends?", answer: "The extension stops 24 hours after the trial expires, with warnings from 7 days before. Lists that use UserTasks forms go back to SharePoint's own forms and workflows started by SharePoint events pause. Nothing is deleted: add a licence and the same forms come back and the paused workflows resume." },
  { question: "How much does it cost after the trial?", answer: `${SHAREPOINT_PRICE.amount} ${SHAREPOINT_PRICE.currency} ${SHAREPOINT_PRICE.unit}, including ${SHAREPOINT_PRICE.includes}. UserTasks itself is open source and free to self-host.` },
  { question: "My server can't reach the internet. Can I still start a trial?", answer: "Yes. Start the trial on any connected computer with your farm ID (or the request code UserTasks shows when it can't reach usertasks.com). On a connected machine with Docker, make the signed offline bundle with your licence (install.sh --bundle-download), carry it to the server and install from it." },
  { question: "Why does the installer ask for my licence?", answer: "The SharePoint extension is commercial, so it comes built into its own UserTasks image, the SharePoint edition, which usertasks.com lets you download with a valid trial or purchased licence. The installer sends only the licence file, nothing from your farm; usertasks.com checks its signature and dates and gives the installer a download pass for 30 minutes. If a licence lapses, new downloads and upgrades are refused, but UserTasks that is already running keeps running." },
]

function StepHeader({ n, title, time, icon }: { n: number; title: string; time: string; icon: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-primary) text-lg font-bold text-(color:--mkt-paper)" aria-hidden="true">{n}</span>
      <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl"><span className="sr-only">Step {n}: </span>{title}</h2>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-(color:--mkt-ink)/[0.05] px-2.5 py-1 text-xs font-semibold text-(color:--mkt-muted)"><Clock size={12} aria-hidden="true" /> {time}</span>
      <span className="ml-auto hidden text-(color:--mkt-bronze) sm:inline" aria-hidden="true">{icon}</span>
    </div>
  )
}

function Shot({ src, alt, caption }: { src: StaticImageData; alt: string; caption: string }) {
  return (
    <figure>
      <ScreenshotFrame><Image src={src} alt={alt} sizes="(min-width: 1024px) 520px, 100vw" placeholder="blur" className="h-auto w-full" /></ScreenshotFrame>
      <figcaption className="mt-2 text-center text-xs text-(color:--mkt-muted)">{caption} (real screen, demo data).</figcaption>
    </figure>
  )
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-2 space-y-3 text-sm leading-6 text-(color:--mkt-text)">{children}</div>
    </div>
  )
}

/** /sharepoint/get-started. `trialsAvailable`: the trial form is open (else "Contact us"). */
export function SharePointGetStartedPage({ trialsAvailable = false }: { trialsAvailable?: boolean } = {}) {
  const baseUrl = publicBaseUrl()
  const path = SHAREPOINT_GET_STARTED.path
  const jsonLd = [
    webPageNode(baseUrl, path, { name: SHAREPOINT_GET_STARTED.title, description: SHAREPOINT_GET_STARTED.description }),
    breadcrumbNode(baseUrl, [{ name: "SharePoint on-premises", path: "/sharepoint" }, { name: "Get started", path }]),
    howToNode("Get started with UserTasks for SharePoint Server", GET_STARTED_STEPS.map((s) => ({ title: s.title, body: s.body })), { description: SHAREPOINT_GET_STARTED.description, totalTime: "PT50M" }),
    faqNode(GET_STARTED_FAQS),
  ]
  const trialHref = trialsAvailable ? SHAREPOINT_TRIAL.path : "/contact"
  const trialLabel = trialsAvailable ? `Start the ${SHAREPOINT_TRIAL.days}-day free trial` : "Contact us for a trial"
  const card = "rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-5 sm:p-6"

  return (
    <div className="relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader />
      <main className="relative overflow-hidden">
        <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-x-0 top-0 h-[32rem]" />
        <section className="relative mx-auto max-w-5xl px-4 pb-10 pt-14 sm:px-6 lg:pt-20">
          <p className="text-sm text-(color:--mkt-muted)"><Link href="/sharepoint" className="hover:underline">SharePoint on-premises</Link> / Get started</p>
          <h1 className="mt-4 font-display text-display font-bold">From free trial to your first <span className="mkt-gradient-text-ink">SharePoint workflow.</span></h1>
          <p className="mt-5 max-w-2xl mkt-body text-(color:--mkt-text)">Four steps and about an hour: get a trial licence, install UserTasks next to your farm, connect SharePoint, and put UserTasks forms and workflows on a list. For {SUPPORTED_VERSIONS}.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={trialHref} className="mkt-btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold" data-testid="get-started-trial">{trialLabel} <ArrowRight size={16} aria-hidden="true" /></Link>
            <span className="flex flex-wrap items-center gap-2 text-sm text-(color:--mkt-muted)">Self-hosted <ProductionReadyBadge /> · UserTasks Cloud <BetaBadge /></span>
          </div>
          <ol className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="The four steps">
            {GET_STARTED_STEPS.map((s, i) => (
              <li key={s.title}><a href={`#step-${i + 1}`} className="block h-full rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-3 text-sm hover:border-(color:--mkt-bronze)/40"><span className="font-bold text-(color:--mkt-bronze)">{i + 1}.</span> {s.title}<span className="mt-1 block text-xs text-(color:--mkt-muted)">{s.time}</span></a></li>
            ))}
          </ol>
        </section>

        {/* Step 1 */}
        <section id="step-1" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-5xl space-y-6 px-4 py-14 sm:px-6">
            <StepHeader n={1} title="Start your free trial" time="2 minutes" icon={<Rocket size={22} />} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Sub title="Find your farm ID">
                <p>On a SharePoint server, open the <strong>SharePoint Management Shell</strong> and run:</p>
                <Snippet code={FARM_ID_COMMAND} language="powershell" />
                <p>It prints a GUID such as <InlineCode>3f2504e0-4f89-11d3-9a0c-0305e82c3301</InlineCode>. UserTasks recognises the farm by its authentication realm, which is the farm ID unless someone changed it. If yours was changed, use the value from <InlineCode>{REALM_COMMAND}</InlineCode> instead.</p>
              </Sub>
              <div className={card}>
                <h3 className="font-semibold">What you get</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-(color:--mkt-text)">
                  <li>Every feature of the SharePoint extension for 30 days, on that farm</li>
                  <li>A signed licence on screen and by email (no card)</li>
                  <li>One trial per farm and per company</li>
                </ul>
                <Link href={trialHref} className="mkt-btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold">{trialLabel} <ArrowRight size={16} aria-hidden="true" /></Link>
                <p className="mt-3 text-xs leading-5 text-(color:--mkt-muted)">Prefer to do it later? Install UserTasks without <InlineCode>--edition</InlineCode> first; <strong>Settings → Extensions → Start a 30-day trial</strong> asks usertasks.com for you (or gives you a request code if the server is offline), and <InlineCode>{EDITION_SWITCH_SH}</InlineCode> then switches it to the SharePoint edition, keeping its data.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Step 2 */}
        <section id="step-2" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-5xl space-y-6 px-4 py-14 sm:px-6">
            <StepHeader n={2} title="Install UserTasks, the fastest way" time="15 minutes" icon={<Download size={22} />} />
            <p className="max-w-3xl text-sm leading-6 text-(color:--mkt-text)">Use a machine next to the farm, <strong>not a SharePoint server</strong>, with Docker running: about 2 GB of memory for the containers (4 GB or more recommended) and 5 GB of disk. Give it an <strong>HTTPS address</strong> that SharePoint and your users can reach. <Link href="/docs/self-hosting/requirements" className="font-semibold text-(color:--mkt-bronze) hover:underline">Requirements</Link></p>
            <p className="max-w-3xl text-sm leading-6 text-(color:--mkt-text)">SharePoint support comes in its own edition of UserTasks. Put the <InlineCode>.licence</InlineCode> file from step 1 in the folder you run the installer from: with <InlineCode>--edition sharepoint</InlineCode> it checks the licence with usertasks.com, downloads the SharePoint edition (signed, and checked before it runs) and installs the licence for you. It&apos;s the same one-line installer as UserTasks itself (<InlineCode>{INSTALL_SH}</InlineCode>, <InlineCode>{INSTALL_PS1}</InlineCode>), plus two options.</p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <article className={`${card} min-w-0`}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">Windows (PowerShell)</p>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">A Windows Server or PC with Docker Desktop (WSL 2 backend, Linux containers).</p>
                <div className="mt-3 min-w-0"><Snippet code={EDITION_INSTALL_PS1} language="powershell" wrap /></div>
                <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)">To set the address people will open, use this instead and replace <InlineCode>https://usertasks.corp.example</InlineCode> with yours:</p>
                <div className="mt-2 min-w-0"><Snippet code={EDITION_INSTALL_PS1_URL} language="powershell" wrap /></div>
              </article>
              <article className={`${card} min-w-0`}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">Linux server (Docker)</p>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Any Linux server with Docker Engine and the Compose plugin; the installer can install Docker on common distributions.</p>
                <div className="mt-3 min-w-0"><Snippet code={EDITION_INSTALL_SH} wrap /></div>
                <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)">Add <InlineCode>--url https://usertasks.corp.example</InlineCode> (replace it with yours) for the address people will open.</p>
              </article>
            </div>
            <ol className="grid gap-4 sm:grid-cols-3">
              <li className={card}><p className="font-semibold">Create your admin account</p><p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">Open the address the installer prints and enter the <strong>setup code</strong> it shows on the <em>Create your admin account</em> screen.</p></li>
              <li className={card}><p className="font-semibold">Check the licence</p><p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">The installer installed it: <strong>Settings → Licence</strong> shows it with its expiry. A renewed or purchased licence goes there too (upload the <InlineCode>.licence</InlineCode> file or paste it); upgrades use it.</p></li>
              <li className={card}><p className="font-semibold">Turn on SharePoint</p><p className="mt-1 text-sm leading-6 text-(color:--mkt-text)"><strong>Settings → Extensions → SharePoint</strong> → Enabled. Don&apos;t see SharePoint there? That install runs plain UserTasks: switch it to the SharePoint edition on the server, keeping all its data, with <InlineCode>{EDITION_SWITCH_SH}</InlineCode> (Windows: <InlineCode>-Edition sharepoint</InlineCode>).</p></li>
            </ol>
            <p className="text-sm text-(color:--mkt-muted)">No internet on the server? On a connected machine with Docker, make the signed offline bundle with your licence (<InlineCode>{EDITION_BUNDLE_SH}</InlineCode>), carry it over and install from it: <Link href="/docs/self-hosting/air-gapped" className="font-semibold text-(color:--mkt-bronze) hover:underline">air-gapped installation</Link>. More options: <Link href="/install" className="font-semibold text-(color:--mkt-bronze) hover:underline">the installer</Link>.</p>
          </div>
        </section>

        {/* Step 3 */}
        <section id="step-3" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-5xl space-y-8 px-4 py-14 sm:px-6">
            <StepHeader n={3} title="Connect SharePoint" time="20 minutes" icon={<PlugZap size={22} />} />
            <div className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-6">
                <Sub title="a. Let UserTasks reach the farm">
                  <p>Farms are on private addresses, which UserTasks blocks by default. Allow yours with <InlineCode>EGRESS_PRIVATE_ALLOW</InlineCode> (host names, <InlineCode>*.domain</InlineCode> or CIDRs, for example <InlineCode>*.corp.example</InlineCode>). Prefer HTTPS; add your internal CA in the connection.</p>
                </Sub>
                <Sub title="b. Connect a site">
                  <p><strong>Integrations → SharePoint Server</strong>: the site collection URL and a service account (Negotiate, NTLM or Kerberos). Then <strong>SharePoint → Connect a site</strong>: <em>Test connection</em> shows the farm; <em>Connect site</em> counts it against your licence (once per farm). Tick the lists to use.</p>
                </Sub>
                <Sub title="c. Set up the add-in">
                  <p>Create a certificate (self-signed is fine):</p>
                  <Snippet code={OPENSSL_COMMAND} wrap />
                  <p><strong>Settings → Integrations → SharePoint add-in</strong>: two new GUIDs as client ID and issuer ID, the certificate and its private key (stored encrypted, never leaves UserTasks). <em>Test high-trust access</em> checks it. Add your SharePoint addresses to <strong>Settings → Trusted embedding</strong> for the web parts.</p>
                </Sub>
                <Sub title="d. Install it in the farm">
                  <p>Download the add-in package (<InlineCode>UserTasks.app</InlineCode>) and <InlineCode>Install-UserTasksAddin.ps1</InlineCode> from UserTasks. A farm administrator puts both in one folder on a SharePoint server and runs, in an elevated SharePoint Management Shell:</p>
                  <Snippet code={ADDIN_COMMAND} language="powershell" wrap />
                  <p>The script trusts the certificate, adds UserTasks to SharePoint&apos;s outbound allowlist (restarting the Timer Service and recycling the application pools), grants the add-in per site collection and installs it from the farm&apos;s App Catalog. Safe to run again; <InlineCode>-Upgrade</InlineCode> after a newer package, <InlineCode>-Uninstall</InlineCode> to remove it.</p>
                </Sub>
              </div>
              <div className="space-y-6">
                <Shot src={shotLibrary} alt="The UserTasks button on the ribbon of a SharePoint document library" caption="The UserTasks button on a library" />
                <p className="text-sm leading-6 text-(color:--mkt-text)">No route from the farm to UserTasks, or using UserTasks Cloud (beta)? SharePoint&apos;s calls can go through the <Link href="/docs/integrations/gateways" className="font-semibold text-(color:--mkt-bronze) hover:underline">on-premises gateway</Link>.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Step 4 */}
        <section id="step-4" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-5xl space-y-8 px-4 py-14 sm:px-6">
            <StepHeader n={4} title="Get going" time="10 minutes" icon={<MousePointerClick size={22} />} />
            <div className="grid gap-8 lg:grid-cols-2">
              <ol className="space-y-5 text-sm leading-6 text-(color:--mkt-text)">
                <li><strong className="text-(color:--mkt-ink)">Click UserTasks on a list.</strong> The first click opens <em>Set up UserTasks for &lt;list&gt;</em>: the API reference, a form set (New, Edit, View) and a workflow, with the events that start it in plain words. One <strong>Create</strong> makes them.</li>
                <li><strong className="text-(color:--mkt-ink)">SharePoint&apos;s forms are replaced.</strong> The generated forms become the list&apos;s forms and open inside the SharePoint page. <em>Use SharePoint&apos;s forms again</em> restores the originals exactly.</li>
                <li><strong className="text-(color:--mkt-ink)">See the list dashboard.</strong> Later clicks open <em>UserTasks for &lt;list&gt;</em>: Overview, Runs, Metrics, Assets and Permissions. Edit the form or workflow in its designer without leaving SharePoint.</li>
                <li><strong className="text-(color:--mkt-ink)">Bring what you have.</strong> Import InfoPath forms, SharePoint Designer 2010 workflows and Nintex workflows (<Link href="/docs/sharepoint/migration" className="font-semibold text-(color:--mkt-bronze) hover:underline">migration</Link>). <em>Import from Nintex</em> in the designer checks the list&apos;s columns and adds any that are missing.</li>
                <li><strong className="text-(color:--mkt-ink)">Add the My tasks web part</strong> to a classic page so people see their approvals in SharePoint (<Link href="/docs/sharepoint/web-parts" className="font-semibold text-(color:--mkt-bronze) hover:underline">web parts</Link>).</li>
              </ol>
              <div className="space-y-6">
                <Shot src={shotSetup} alt="Set up UserTasks for a SharePoint list: API reference, forms and a workflow" caption="The first click: set up a list" />
              </div>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              <Shot src={shotForm} alt="A UserTasks New form inside a SharePoint page" caption="A generated form inside SharePoint" />
              <Shot src={shotOverview} alt="The Overview tab of the UserTasks list dashboard" caption="The list dashboard" />
              <Shot src={shotMyTasks} alt="The UserTasks My tasks web part on a SharePoint page" caption="The My tasks web part" />
            </div>
            <div className="rounded-2xl border border-(color:--mkt-bronze)/25 bg-[#FFF8EC] p-5 text-sm leading-6 text-(color:--mkt-ink-soft)">
              <p><strong>When the trial ends</strong>, the extension stops 24 hours later: lists go back to SharePoint&apos;s own forms and SharePoint-triggered workflows pause. Nothing is deleted, and a licence ({SHAREPOINT_PRICE.amount} {SHAREPOINT_PRICE.currency} per farm per year) brings everything back. <Link href="/docs/sharepoint/trial" className="font-semibold text-(color:--mkt-bronze) hover:underline">Trial guide</Link></p>
            </div>
          </div>
        </section>

        <FaqList faqs={GET_STARTED_FAQS} />

        <section className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-12 sm:px-6">
            <p className="font-display text-2xl font-bold">Ready when you are.</p>
            <div className="flex flex-wrap gap-3">
              <Link href={trialHref} className="mkt-btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold">{trialLabel} <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/docs/sharepoint" className="inline-flex items-center gap-2 rounded-xl border border-(color:--mkt-ink)/[0.12] px-5 py-3 font-semibold">SharePoint docs</Link>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter cta={false} />
    </div>
  )
}
