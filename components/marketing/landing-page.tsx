import type { CSSProperties } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  Bot,
  Braces,
  Check,
  Cloud,
  Database,
  FileInput,
  Files,
  GitBranch,
  ListChecks,
  Package,
  Palette,
  Plug,
  Radio,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Waves,
  Workflow,
} from "lucide-react"
import { SectionHeading, Shot, SiteNav, Snippet } from "@/components/marketing/marketing-ui"
import { aiConnectors, CONNECTOR_COUNT, shortProviderName, WORKFLOW_NODE_COUNT } from "@/lib/marketing-connectors"
import { UseCaseCard } from "@/components/marketing/use-case-page"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import type { ScreenshotName } from "@/lib/docs/screenshot-names"
import { repositoryUrl, SOURCE_RELEASE_NOTE } from "@/lib/site-links"
import { useCasesInGroup } from "@/lib/use-cases"
import { GalleryTeaser } from "@/components/gallery/gallery-teaser"
import { Wordmark } from "@/components/brand/logo"
import { FormsTasksShowcase } from "@/components/marketing/forms-tasks-showcase"

/**
 * Cloud-edition product page for the headless workflow engine. Server-rendered;
 * the only client islands are the copy buttons on the code samples. Uses the
 * brand language of the rest of the public site: cream paper, ink text, bronze
 * accents and Fraunces headings (--font-display from the root layout).
 */

const THEME = {
  background: "linear-gradient(170deg, var(--mkt-paper) 0%, #F3EFE6 40%, #F7F4EC 100%)",
  // globals.css themes the app through --theme-* variables (h1–h4, bg-white…)
  // with light app defaults; reset them to this page's palette.
  "--theme-primary": "var(--mkt-primary)",
  "--theme-primary-hover": "var(--mkt-primary-hover)",
  "--theme-primary-light": "rgba(23,21,15,0.14)",
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
  "--theme-accent": "var(--mkt-primary)",
} as CSSProperties

const CLI_EXAMPLES: Array<{ verb: string; title: string; body: string; code: string }> = [
  {
    verb: "Create",
    title: "Create anything from a file",
    body: "Every REST operation is a command. Send JSON or YAML with -f, or set fields inline.",
    code: `usertasks workflows create -f invoice-approval.json
usertasks email-templates create --set name="Invoice approved" \\
  --set subject="Invoice {{invoice_number}} approved" --set html_body=@approved.html
usertasks log-destinations create -f splunk.json`,
  },
  {
    verb: "Update",
    title: "Edit workflows in your editor",
    body: "Pull the draft as JSON, change it, push it back and publish. Runs keep the old version until you do.",
    code: `usertasks workflows definition <id> -o json > wf.json
$EDITOR wf.json
usertasks workflows update <id> -f wf.json
usertasks workflows publish <id> --set notes="CFO step over 50k"`,
  },
  {
    verb: "Delete",
    title: "Clean up safely",
    body: "Destructive commands confirm on a terminal and take --yes in scripts. Deletions check dependencies first.",
    code: `usertasks roles delete <id>
usertasks references bulk-delete --set ids:='["…","…"]' --yes
usertasks api-keys revoke <id> --yes`,
  },
  {
    verb: "Monitor",
    title: "Watch it run",
    body: "Tail the live event stream with filters, list failed runs, check log shipping.",
    code: `usertasks logs tail --category workflow --severity warn
usertasks runs list --status failed
usertasks log-destinations status <id>`,
  },
]

const HEADLINERS: Array<{ href: string; icon: typeof Workflow; eyebrow: string; title: string; shot: ScreenshotName; alt: string; points: string[] }> = [
  { href: "/workflows", icon: Workflow, eyebrow: "Workflows", title: "Complex workflows, built visually", shot: "workflows-process-viewer", alt: "The process view of a completed run: the path through the approval policy, the finance manager approval and both parallel branches, with the steps that did not run greyed out", points: [`Branches, parallel paths, loops and sub-workflows — ${WORKFLOW_NODE_COUNT} node types`, "Decision tables, User Tasks, SLAs, timers, events and error paths", "Save & Test with real forms, versions and live migration"] },
  { href: "/forms", icon: FileInput, eyebrow: "Forms", title: "Forms that start and drive your workflows", shot: "forms-page", alt: "A form page with a header, three-column rows, a customer lookup and three uploaded files", points: ["Grid designer with 18 field types: lookups, data tables you can filter and edit, attachments", "Rules that show, hide, fill or lock fields; custom controls as web components", "Share a link, embed it in your website or print a QR code; buttons start workflows"] },
  { href: "/documents", icon: Files, eyebrow: "Documents", title: "Read, compare and transform documents", shot: "documents-compare-report", alt: "A side-by-side comparison report with deleted words in red and inserted words in green", points: ["Word, Excel, PowerPoint, PDF with OCR, Markdown and HTML", "Redlines with Word tracked changes and side-by-side reports", "Convert, split, extract to tables, redact personal data"] },
  { href: "/media", icon: Waves, eyebrow: "Media", title: "AI for images, audio and video", shot: "media-designer", alt: "The workflow designer with Analyze Image and Redact Image steps and the Redact Image settings open: Google Gemini as provider, faces and sensitive text selected", points: ["Transcribe with speakers, timestamps and SRT / VTT subtitles", "Blur faces, plates and ID numbers; bleep spoken card numbers", "Analyse images and video, generate images and speech — your own key"] },
]

const INTEGRATION_PILLARS: Array<{ icon: typeof Workflow; title: string; points: string[] }> = [
  { icon: Plug, title: "Any API", points: ["REST and OData, with API key, bearer, basic or OAuth 2.0", "OpenAPI and Postman import: one reference per operation", "Response models and a data picker — click fields, not JSON paths"] },
  { icon: Database, title: "Data and events", points: ["PostgreSQL, SQL Server, MySQL, Oracle, Snowflake and MongoDB", "Inbound webhooks that start runs or answer in line", "Outbound webhooks and HTTP calls, retried and logged"] },
  { icon: Terminal, title: "Both directions", points: ["An MCP server for Claude, ChatGPT, Cursor and other AI clients", "Your MCP servers as tools for agents", "REST API, TypeScript SDK and CLI for every operation"] },
]

const DESTINATIONS = [
  { name: "Splunk HEC", note: "HTTP Event Collector, index and sourcetype" },
  { name: "Datadog Logs", note: "Every site, tags and facets out of the box" },
  { name: "OpenTelemetry", note: "OTLP/HTTP to any collector or vendor" },
  { name: "Webhooks", note: "Signed HTTPS batches (HMAC-SHA256)" },
  { name: "Live tail", note: "Server-Sent Events, the CLI and the SDK" },
]

const FEATURES: Array<{ icon: typeof Workflow; title: string; body: string; href: string; shot?: ScreenshotName }> = [
  { icon: Workflow, title: "Workflows", body: `${WORKFLOW_NODE_COUNT} node types: triggers, branches, loops, parallel paths, waits, sub-workflows, documents and error handling. Durable runs with a full step history.`, href: "/workflows", shot: "run-detail" },
  { icon: FileInput, title: "Forms", body: "Grid forms with lookups, file uploads, rules, buttons and themes: on tasks, workflow starts, their own pages and other websites. Custom controls let you build any field you need. Every submission validated on the server.", href: "/forms", shot: "forms-designer" },
  { icon: Files, title: "Documents", body: "Read Word, Excel, PowerPoint, PDF and Markdown, redline two versions, convert, extract to tables and redact personal data — inside the run.", href: "/documents", shot: "documents-compare" },
  { icon: Waves, title: "Media", body: "Transcribe recordings, analyse photos and video, blur faces and ID numbers, bleep spoken personal data, generate images and speech — with your own AI provider key.", href: "/media", shot: "media-transcribe" },
  { icon: ListChecks, title: "Human tasks", body: "User Tasks with typed fields, outcomes and attachments, SLAs, reminders, escalation and multi-assignee rules. One task list with queued tasks and personal queue rules, or your own UI.", href: "/docs/tasks", shot: "task-detail" },
  { icon: Plug, title: "Integrations", body: `${CONNECTOR_COUNT} connectors, plus any REST or OData API, webhook and database — encrypted credentials, OAuth and OpenAPI import.`, href: "/connectors", shot: "integrations" },
  { icon: Scale, title: "Decision tables", body: "Ordered, typed business rules your analysts can change without touching a workflow. Testable from the API.", href: "/docs/decision-tables", shot: "decision-table" },
  { icon: Bot, title: "AI agents, optional", body: "Agents on Claude, OpenAI, Gemini, Mistral, local models and more, with granted tools, files, structured outputs and traces. Leave them off if you don't need them.", href: "/connectors#ai" },
  { icon: ShieldCheck, title: "Governance", body: "Roles and fine-grained permissions, scoped API keys, OAuth, SSO and directory sync, audit, retention and a deletion queue.", href: "/docs/governance", shot: "roles" },
  { icon: Package, title: "Packages", body: "Bundle a workflow and everything it uses into a signed, versioned package. Install it in another environment, finish the setup it asks for, upgrade in place — or start from the gallery.", href: "/docs/packages", shot: "packages-library-complete" },
  { icon: Palette, title: "Your brand", body: "One workspace theme: colours for light and dark, fonts (or your own woff2), shape, density and logos — designed with a live preview, or set from the API, CLI and config as code.", href: "/docs/governance/workspace-theme", shot: "theme-designer" },
]

// Absolute medians from the final run in docs/perf/results.md. No
// before/after or competitor comparisons on the marketing site.
const PERF = [
  { value: "4–8 ms", label: "REST API responses" },
  { value: "3–5 ms", label: "MCP tool calls" },
  { value: "< 1 s", label: "200 queued workflows, start to finish" },
  { value: "~1 µs", label: "Evaluating a template expression" },
  { value: "~40 ms", label: "A member’s task list, row-level security applied" },
]

export function LandingPage() {
  // Null until the public repository exists: repository links are omitted.
  const repoUrl = repositoryUrl()
  return (
    <div className="mkt min-h-screen text-(color:--mkt-ink)" style={THEME}>
      <header className="relative z-20">
        <SiteNav />
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-bronze)/30 bg-(color:--mkt-gold)/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">
              <Sparkles size={13} aria-hidden="true" /> Open source · Apache-2.0
            </p>
            <h1 className="mt-6 font-display text-display font-bold">
              The headless workflow engine you drive from code.
            </h1>
            <p className="mt-6 mkt-body text-(color:--mkt-text)">
              Build complex processes on a visual canvas or as JSON, put people in the loop with typed tasks, connect any system and any AI model — then run, change and watch all of it from the <strong className="text-(color:--mkt-ink)">REST API</strong>, the <strong className="text-(color:--mkt-ink)">MCP server</strong> or the <strong className="text-(color:--mkt-ink)">CLI</strong>. Self-host it or use the cloud.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/docs" className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) shadow-lg shadow-(color:--mkt-primary)/20 hover:bg-(color:--mkt-primary-hover)">
                Read the docs <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/docs/quickstart/self-host" className="inline-flex items-center justify-center gap-2 rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">
                Self-host in ten minutes
              </Link>
            </div>
            <div className="mt-6 max-w-md">
              <Snippet code="npm install -g @usertasks/cli" />
            </div>
          </div>
          <div className="mt-12">
            <Shot name="workflows-designer" alt="The UserTasks workflow designer with a supplier invoice workflow: a loop over invoice lines, an approval policy, a four-way branch to approval tasks, a rework loop, vendor onboarding as a sub-workflow, parallel payment and notification and an error path" sizes="(min-width: 1152px) 1104px, 100vw" priority />
          </div>
          <ul className="mt-8 grid gap-3 text-sm text-(color:--mkt-text) sm:grid-cols-3">
            {[
              [Braces, "API-first: every screen is an endpoint, described by OpenAPI 3.1"],
              [Terminal, "A command for every operation, plus config as code"],
              [Radio, "Every run, call and change in one exportable event stream"],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Braces
              return (
                <li key={text as string} className="flex items-start gap-2"><I size={16} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />{text as string}</li>
              )
            })}
          </ul>
        </section>

        {/* Headliners: workflows, forms, documents, media */}
        <section id="workflows-forms-documents" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="Workflows, forms, documents and media" title="Build the process. Collect what it needs. Read, hear and see the files.">
              Model complex workflows visually — branches, parallel paths, loops, rules, people and error paths — start them from forms with lookups and uploads, read, compare and transform the documents in the steps that follow, and transcribe, analyse and redact the recordings and photos.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
              {HEADLINERS.map(({ href, icon: Icon, eyebrow, title, shot, alt, points }) => (
                <Link key={href} href={href} className="group flex flex-col overflow-hidden rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                  <div className="aspect-[16/10] overflow-hidden border-b border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-white)">
                    <Image src={SCREENSHOTS[shot]} alt={alt} sizes="(min-width: 1152px) 552px, (min-width: 768px) 50vw, 100vw" placeholder="blur" className="h-full w-full object-cover object-top" />
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-(color:--mkt-bronze)"><Icon size={14} aria-hidden="true" />{eyebrow}</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">{title}</h3>
                    <ul className="mt-4 flex-1 space-y-2 text-sm text-(color:--mkt-text)">
                      {points.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{point}</li>)}
                    </ul>
                    <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Explore {eyebrow.toLowerCase()} <ArrowRight size={14} aria-hidden="true" /></span>
                  </div>
                </Link>
              ))}
            </div>
            <p className="mt-6 text-sm text-(color:--mkt-text)"><Link href="/workflows#actions" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Custom actions: build your own sandboxed steps, or install six official ones <ArrowRight size={14} aria-hidden="true" /></Link></p>
          </div>
        </section>

        <FormsTasksShowcase />

        {/* Integrations and AI */}
        <section id="integrations" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="Integrations and AI" title="Integrate with any system — and any AI.">
              Import an OpenAPI document, connect a database, start from one of {CONNECTOR_COUNT} connectors or call any HTTP endpoint. Then put AI models to work on the same governed connections, with a person reviewing what matters.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
              {INTEGRATION_PILLARS.map(({ icon: Icon, title, points }) => (
                <article key={title} className="flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-6">
                  <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                  <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                  <ul className="mt-3 space-y-2 text-sm text-(color:--mkt-text)">
                    {points.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{point}</li>)}
                  </ul>
                </article>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-gradient-to-br from-(color:--mkt-primary)/[0.04] to-(color:--mkt-gold)/[0.10] p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-xl">
                  <h3 className="flex items-center gap-2 text-lg font-semibold"><Bot size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Any AI model, under your rules</h3>
                  <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">Agents call the references, workflows and MCP servers you grant them, read the files you hand them, return typed outputs — and stop for a person when a decision needs one.</p>
                </div>
                <ul className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end" aria-label="AI providers with a ready-made connector">
                  {aiConnectors().map((provider) => <li key={provider.key} className="rounded-full border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) px-3 py-1 text-xs font-semibold text-(color:--mkt-ink-soft)">{shortProviderName(provider.name)}</li>)}
                  <li className="rounded-full border border-dashed border-(color:--mkt-ink)/20 px-3 py-1 text-xs font-semibold text-(color:--mkt-muted)">Any OpenAI-compatible endpoint</li>
                </ul>
              </div>
            </div>
            <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Link href="/connectors" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">See every connector <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/connectors#ai" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">AI agents and MCP <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/media" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">AI for images, audio and video <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="Use cases" title="What teams build on it.">
              Human steps inside your own apps, approvals you can prove, agents with a person in the loop, an integration hub — and a home for workflows moving off SharePoint, Nintex or K2.
            </SectionHeading>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {useCasesInGroup("platform").map((useCase) => <UseCaseCard key={useCase.slug} useCase={useCase} />)}
              <Link href="/use-cases" className="flex flex-col justify-center rounded-2xl border border-dashed border-(color:--mkt-ink)/15 p-6 text-center hover:border-(color:--mkt-bronze)/40">
                <span className="font-display text-xl font-bold">All use cases</span>
                <span className="mt-2 text-sm text-(color:--mkt-text)">Including records requests, claims, KYC, call QA and moderation on images, audio and video.</span>
                <span className="mt-2 inline-flex items-center justify-center gap-1 text-sm font-semibold text-(color:--mkt-bronze)">Browse them <ArrowRight size={14} aria-hidden="true" /></span>
              </Link>
            </div>
          </div>
        </section>

        {/* Package gallery */}
        <section id="gallery" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <GalleryTeaser />
          </div>
        </section>

        {/* CLI */}
        <section id="cli" className="scroll-mt-8 border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="Everything from the CLI" title="Create, update, delete and monitor — from your terminal or CI.">
              <code className="font-mono text-base">usertasks</code> talks only to the public API, so it obeys the same permissions as any client. Log in with your browser or an API key, keep profiles for dev and prod, and pipe JSON into the rest of your tools.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2">
              {CLI_EXAMPLES.map((example) => (
                <div key={example.verb} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">{example.verb}</p>
                  <h3 className="mt-1 text-lg font-semibold">{example.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{example.body}</p>
                  <div className="mt-4"><Snippet code={example.code} /></div>
                </div>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <figure>
                <Shot name="cli-edit-workflow" alt="Terminal output of exporting, updating and publishing a workflow with the usertasks CLI" sizes="(min-width: 1024px) 540px, 100vw" />
                <figcaption className="mt-2 text-sm text-(color:--mkt-muted)">Real output: edit a workflow as a file and publish it.</figcaption>
              </figure>
              <figure>
                <Shot name="cli-logs-tail" alt="Terminal output of usertasks logs tail streaming live workflow events" sizes="(min-width: 1024px) 540px, 100vw" />
                <figcaption className="mt-2 text-sm text-(color:--mkt-muted)">Real output: <code className="font-mono">logs tail</code> following runs as they happen.</figcaption>
              </figure>
            </div>
            <p className="mt-8 text-sm text-(color:--mkt-text)">
              <Link href="/docs/cli" className="font-semibold text-(color:--mkt-bronze) hover:underline">CLI guide</Link>{" · "}
              <Link href="/docs/cli/commands" className="font-semibold text-(color:--mkt-bronze) hover:underline">Every command</Link>{" · "}
              <Link href="/docs/cli/recipes" className="font-semibold text-(color:--mkt-bronze) hover:underline">Recipes: dev → prod, CI, monitoring</Link>
            </p>
          </div>
        </section>

        {/* Log export */}
        <section id="logs" className="scroll-mt-8 mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Ship logs anywhere" title="Your workflows, in the log platform you already use.">
            Run transitions, step logs, integration calls, agent runs, task changes, audit and security events — one normalised stream, delivered at least once, usually within seconds. No request bodies, prompts or secrets ever leave.
          </SectionHeading>
          <ul className="mt-8 flex flex-wrap gap-3" aria-label="Supported destinations">
            {DESTINATIONS.map((destination) => (
              <li key={destination.name} className="rounded-xl border border-(color:--mkt-ink)/10 bg-(color:--mkt-white)/70 px-4 py-2.5">
                <span className="block text-sm font-semibold">{destination.name}</span>
                <span className="block text-xs text-(color:--mkt-muted)">{destination.note}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-[3fr_2fr]">
            <Shot name="log-export" alt="Settings, Log Export page listing a Splunk HEC destination and a webhook destination with healthy status and lag" sizes="(min-width: 1024px) 650px, 100vw" />
            <div className="space-y-4">
              <Shot name="cli-log-destinations" alt="Terminal output creating a Splunk destination from a file and checking its status" sizes="(min-width: 1024px) 430px, 100vw" />
              <ul className="space-y-2 text-sm text-(color:--mkt-text)">
                {["Filters by category, type glob, severity and workflow", "Send-test button, lag and last-error per destination", "Pull API with a cursor and an SSE stream for your own consumers"].map((item) => (
                  <li key={item} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{item}</li>
                ))}
              </ul>
              <Link href="/docs/observability" className="inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">Observability guide <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="The engine" title="Everything a real process needs, nothing it doesn't." />
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body, href, shot }) => (
                <Link key={title} href={href} className="group flex flex-col overflow-hidden rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                  {shot ? (
                    <div className="aspect-[16/10] overflow-hidden border-b border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-white)">
                      <Image src={SCREENSHOTS[shot]} alt="" sizes="(min-width: 1024px) 360px, (min-width: 768px) 50vw, 100vw" placeholder="blur" className="h-full w-full object-cover object-left-top" />
                    </div>
                  ) : (
                    <div className="flex aspect-[16/10] items-center justify-center border-b border-(color:--mkt-ink)/[0.06] bg-gradient-to-br from-(color:--mkt-primary)/[0.06] to-(color:--mkt-gold)/[0.12]">
                      <Icon size={40} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                    </div>
                  )}
                  <div className="p-5">
                    <h3 className="flex items-center gap-2 text-lg font-semibold"><Icon size={17} className="text-(color:--mkt-bronze)" aria-hidden="true" />{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Config as code */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Config as code" title={<>Review processes like code. Promote them like code.</>}>
                Export a workspace to files, review the change in a pull request, diff it against production and apply it. Secrets stay out of Git. Or let GitHub sync commit every change and deploy pinned commits for you.
              </SectionHeading>
              <div className="mt-6">
                <Snippet code={`usertasks --profile dev config export ./config
git commit -am "Invoice approval v2"
usertasks --profile prod config diff ./config --exit-code
usertasks --profile prod config apply ./config`} />
              </div>
              <Link href="/docs/config-as-code" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline"><GitBranch size={14} aria-hidden="true" /> Config as code and GitHub sync</Link>
            </div>
            <Shot name="cli-config-diff" alt="Terminal output of usertasks config export and config diff" sizes="(min-width: 1024px) 540px, 100vw" />
          </div>
        </section>

        {/* Performance */}
        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-primary) text-(color:--mkt-code-text)">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-gold-light)">Performance</p>
            <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-5xl" style={{ color: "var(--mkt-paper)" }}>A fast execution engine.</h2>
            <p className="mt-4 max-w-2xl mkt-body text-(color:--mkt-line-strong)">
              Single-digit-millisecond API and MCP calls, a queue that clears hundreds of runs a second, and expressions evaluated in about a microsecond — so the engine is never the slow step in your process.
            </p>
            <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {PERF.map((item) => (
                <div key={item.label} className="flex flex-col-reverse justify-end rounded-xl border border-white/10 p-5">
                  <dt className="mt-2 text-sm leading-5 text-(color:--mkt-faint)">{item.label}</dt>
                  <dd className="font-display text-3xl font-bold text-(color:--mkt-paper)">{item.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-3xl text-xs leading-5 text-(color:--mkt-faint)">
              Medians measured on our benchmark (app and database on one machine). Your numbers depend on network and hosting — <Link href="/docs/performance" className="font-semibold text-(color:--mkt-gold-light) hover:underline">see /docs/performance</Link>.
            </p>
          </div>
        </section>

        {/* Self-host vs cloud */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Run it your way" title="Same code, two ways to run it." />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {[
              { icon: Server, title: "Self-hosted", body: "Apache-2.0. Start on Supabase, our recommended platform, with zero extra configuration. Whenever you're ready, move any area — database, auth, storage, email, secrets — to AWS, Azure, Google Cloud or your own servers. Docker image included.", points: ["Your data stays where you put it", "One reversible usertasks-admin switch per area", "Fully on-premises and air-gapped when you need it"], href: "/deploy-anywhere", cta: "Deploy anywhere" },
              { icon: Cloud, title: "Cloud", body: "The same engine at usertasks.com, run and upgraded by the team that builds it.", points: ["Nothing to install — start in the browser", "Same API, MCP server, CLI and docs", "Move to self-hosting any time with config as code"], href: "/login", cta: "Sign in" },
            ].map(({ icon: Icon, title, body, points, href, cta }) => (
              <div key={title} className="flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/60 p-6">
                <Icon size={22} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-(color:--mkt-text)">
                  {points.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{point}</li>)}
                </ul>
                <Link href={href} className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">{cta} <ArrowRight size={14} aria-hidden="true" /></Link>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-(color:--mkt-ink)/10 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.12] p-8 text-center sm:p-14">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Start with the docs. Ship with the CLI.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-(color:--mkt-text)">Every node, function, permission, MCP tool and command is documented — generated from the code, so it matches what you run.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/docs" className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Documentation <ArrowRight size={16} aria-hidden="true" /></Link>
              {repoUrl && <a href={repoUrl} className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">GitHub</a>}
              <Link href="/login" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Sign in</Link>
            </div>
            {!repoUrl && <p className="mt-6 text-sm text-(color:--mkt-muted)">{SOURCE_RELEASE_NOTE}</p>}
          </div>
        </section>
      </main>

      <footer className="border-t border-(color:--mkt-ink)/[0.07]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Wordmark size={26} />
          <p className="text-xs text-(color:--mkt-subtle)">Open-source headless workflow engine · Apache-2.0 · © {new Date().getFullYear()} UserTasks</p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-(color:--mkt-muted)">
            <Link href="/workflows" className="hover:text-(color:--mkt-ink)">Workflows</Link>
            <Link href="/forms" className="hover:text-(color:--mkt-ink)">Forms</Link>
            <Link href="/documents" className="hover:text-(color:--mkt-ink)">Documents</Link>
            <Link href="/media" className="hover:text-(color:--mkt-ink)">Media</Link>
            <Link href="/connectors" className="hover:text-(color:--mkt-ink)">Integrations</Link>
            <Link href="/use-cases" className="hover:text-(color:--mkt-ink)">Use cases</Link>
            <Link href="/gallery" className="hover:text-(color:--mkt-ink)">Package gallery</Link>
            <Link href="/deploy-anywhere" className="hover:text-(color:--mkt-ink)">Deploy anywhere</Link>
            <Link href="/docs" className="hover:text-(color:--mkt-ink)">Docs</Link>
            <Link href="/docs/api-explorer" className="hover:text-(color:--mkt-ink)">API Explorer</Link>
            <Link href="/open-source" className="hover:text-(color:--mkt-ink)">Why open source</Link>
            <Link href="/contact" className="hover:text-(color:--mkt-ink)">Contact</Link>
            <Link href="/login" className="hover:text-(color:--mkt-ink)">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
