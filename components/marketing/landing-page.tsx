import type { CSSProperties } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  Bot,
  Braces,
  Check,
  Cloud,
  FileInput,
  Files,
  GitBranch,
  ListChecks,
  Palette,
  Plug,
  Radio,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react"
import { SectionHeading, Shot, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseCard } from "@/components/marketing/use-case-page"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import type { ScreenshotName } from "@/lib/docs/screenshot-names"
import { repositoryUrl, SOURCE_RELEASE_NOTE } from "@/lib/site-links"
import { USE_CASES } from "@/lib/use-cases"
import { GalleryTeaser } from "@/components/gallery/gallery-teaser"
import { Wordmark } from "@/components/brand/logo"

/**
 * Cloud-edition product page for the headless workflow engine. Server-rendered;
 * the only client islands are the copy buttons on the code samples. Uses the
 * brand language of the rest of the public site: cream paper, ink text, bronze
 * accents and Fraunces headings (--font-display from the root layout).
 */

const THEME = {
  background: "linear-gradient(170deg, #FAF8F3 0%, #F3EFE6 40%, #F7F4EC 100%)",
  // globals.css themes the app through --theme-* variables (h1–h4, bg-white…)
  // with light app defaults; reset them to this page's palette.
  "--theme-primary": "#17150F",
  "--theme-primary-hover": "#2E2A24",
  "--theme-primary-light": "rgba(23,21,15,0.14)",
  "--theme-card-bg": "#FFFFFF",
  "--theme-card-text": "#1B1916",
  "--theme-surface": "#F5F2EA",
  "--theme-surface-border": "#E6E1D5",
  "--theme-muted-text": "#6E6759",
  "--theme-accent": "#17150F",
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

const DESTINATIONS = [
  { name: "Splunk HEC", note: "HTTP Event Collector, index and sourcetype" },
  { name: "Datadog Logs", note: "Every site, tags and facets out of the box" },
  { name: "OpenTelemetry", note: "OTLP/HTTP to any collector or vendor" },
  { name: "Webhooks", note: "Signed HTTPS batches (HMAC-SHA256)" },
  { name: "Live tail", note: "Server-Sent Events, the CLI and the SDK" },
]

const FEATURES: Array<{ icon: typeof Workflow; title: string; body: string; href: string; shot?: ScreenshotName }> = [
  { icon: Workflow, title: "Workflows", body: "72 node types: triggers, branches, loops, parallel paths, waits, sub-workflows, documents and error handling. Durable runs with a full step history.", href: "/docs/workflows", shot: "run-detail" },
  { icon: FileInput, title: "Forms", body: "Grid forms with lookups, file uploads, buttons and themes — on tasks, workflow starts and their own pages with QR codes. Every submission validated on the server.", href: "/forms", shot: "forms-designer" },
  { icon: Files, title: "Documents", body: "Read Word, Excel, PowerPoint, PDF and Markdown, redline two versions, convert, extract to tables and redact personal data — inside the run.", href: "/documents", shot: "documents-compare" },
  { icon: ListChecks, title: "Human tasks", body: "User Tasks with typed fields and outcomes, queues, SLAs, reminders, escalation and multi-assignee rules — in our task list or your own UI.", href: "/docs/tasks", shot: "task-detail" },
  { icon: Plug, title: "Integrations", body: "REST, OData, webhooks and databases with encrypted credentials, OAuth, OpenAPI import and pre-built connectors.", href: "/docs/integrations", shot: "integrations" },
  { icon: Scale, title: "Decision tables", body: "Ordered, typed business rules your analysts can change without touching a workflow. Testable from the API.", href: "/docs/decision-tables", shot: "decision-table" },
  { icon: Bot, title: "AI agents, optional", body: "Agents on any OpenAI-compatible model with granted tools, structured outputs and traces. Leave them off if you don't need them.", href: "/docs/agents" },
  { icon: ShieldCheck, title: "Governance", body: "Roles and fine-grained permissions, scoped API keys, OAuth, SSO and directory sync, audit, retention and a deletion queue.", href: "/docs/governance", shot: "roles" },
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
    <div className="min-h-screen text-[#1B1916]" style={THEME}>
      {/* Refocus note: compact, links to the full announcement. */}
      <div className="border-b border-[#1B1916]/[0.07] bg-[#17150F] text-[#EDE8DC]">
        <p className="mx-auto max-w-6xl px-4 py-2 text-center text-xs sm:px-6 sm:text-sm">
          UserTasks has refocused on an open-source headless workflow engine.{" "}
          <Link href="/open-source" className="font-semibold text-[#E2C9A0] underline-offset-2 hover:underline">What changed and why →</Link>
        </p>
      </div>

      <header className="relative z-10">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-5 sm:px-6" aria-label="Main">
          <Link href="/" aria-label="UserTasks home"><Wordmark size={34} /></Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="/use-cases" className="hidden whitespace-nowrap rounded-lg px-1.5 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] min-[420px]:inline sm:px-3">Use cases</Link>
            <Link href="/forms" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3 lg:inline">Forms</Link>
            <Link href="/documents" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3 lg:inline">Documents</Link>
            <Link href="/gallery" className="whitespace-nowrap rounded-lg px-1.5 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3">Gallery</Link>
            <Link href="/deploy-anywhere" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:inline sm:px-3">Deploy</Link>
            <a href="#cli" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3 md:inline lg:hidden xl:inline">CLI</a>
            <a href="#logs" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3 md:inline lg:hidden xl:inline">Log export</a>
            <Link href="/docs" className="whitespace-nowrap rounded-lg px-1.5 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3">Docs</Link>
            {repoUrl && <a href={repoUrl} className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3 sm:inline">GitHub</a>}
            <Link href="/login" className="ml-1 whitespace-nowrap rounded-lg bg-[#17150F] px-3 py-2 sm:px-4 text-sm font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Sign in</Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#8A6D45]/30 bg-[#B08A54]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#8A6D45]">
              <Sparkles size={13} aria-hidden="true" /> Open source · Apache-2.0
            </p>
            <h1 className="mt-6 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
              The headless workflow engine you drive from code.
            </h1>
            <p className="mt-6 text-lg leading-8 text-[#4A463E]">
              Design processes on a visual canvas or as JSON, put people in the loop with typed tasks, connect any API — then run, change and watch all of it from the <strong className="text-[#1B1916]">REST API</strong>, the <strong className="text-[#1B1916]">MCP server</strong> or the <strong className="text-[#1B1916]">CLI</strong>. Self-host it or use the cloud.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/docs" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] shadow-lg shadow-[#17150F]/20 hover:bg-[#2E2A24]">
                Read the docs <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/docs/quickstart/self-host" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">
                Self-host in ten minutes
              </Link>
            </div>
            <div className="mt-6 max-w-md">
              <Snippet code="npm install -g @usertasks/cli" />
            </div>
          </div>
          <div className="mt-12">
            <Shot name="designer" alt="The UserTasks workflow designer showing an invoice approval workflow with the User Task settings panel open" sizes="(min-width: 1152px) 1104px, 100vw" priority />
          </div>
          <ul className="mt-8 grid gap-3 text-sm text-[#4A463E] sm:grid-cols-3">
            {[
              [Braces, "API-first: every screen is an endpoint, described by OpenAPI 3.1"],
              [Terminal, "A command for every operation, plus config as code"],
              [Radio, "Every run, call and change in one exportable event stream"],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Braces
              return (
                <li key={text as string} className="flex items-start gap-2"><I size={16} className="mt-0.5 shrink-0 text-[#8A6D45]" aria-hidden="true" />{text as string}</li>
              )
            })}
          </ul>
        </section>

        {/* Forms and documents */}
        <section id="forms-and-documents" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="New: forms and documents" title="People fill in the form. The workflow reads the files.">
              Collect what a process needs on a form — fields on a grid, lookups into your data, photos and PDFs — then read, compare and transform those documents in the steps that follow.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {[
                { href: "/forms", icon: FileInput, eyebrow: "Forms", title: "Forms that start and drive your workflows", shot: "forms-page" as ScreenshotName, alt: "A form page with a header, three-column rows, a customer lookup and three uploaded files", points: ["Grid designer with 17 field types, lookups and attachments", "Buttons that start workflows; headers and themes", "Form pages with QR codes and a Form submitted trigger"] },
                { href: "/documents", icon: Files, eyebrow: "Documents", title: "Read, compare and transform documents", shot: "documents-compare-report" as ScreenshotName, alt: "A side-by-side comparison report with deleted words in red and inserted words in green", points: ["Word, Excel, PowerPoint, PDF with OCR, Markdown and HTML", "Redlines with Word tracked changes and side-by-side reports", "Convert, split, extract to tables, redact personal data"] },
              ].map(({ href, icon: Icon, eyebrow, title, shot, alt, points }) => (
                <Link key={href} href={href} className="group flex flex-col overflow-hidden rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] transition hover:border-[#8A6D45]/40 hover:shadow-md">
                  <div className="aspect-[16/9] overflow-hidden border-b border-[#1B1916]/[0.06] bg-[#FFFFFF]">
                    <Image src={SCREENSHOTS[shot]} alt={alt} sizes="(min-width: 1024px) 540px, 100vw" placeholder="blur" className="h-full w-full object-cover object-top" />
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#8A6D45]"><Icon size={14} aria-hidden="true" />{eyebrow}</p>
                    <h3 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">{title}</h3>
                    <ul className="mt-4 flex-1 space-y-2 text-sm text-[#4A463E]">
                      {points.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[#4F7A5B]" aria-hidden="true" />{point}</li>)}
                    </ul>
                    <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] group-hover:underline">Explore {eyebrow.toLowerCase()} <ArrowRight size={14} aria-hidden="true" /></span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="Use cases" title="What teams build on it.">
              Human steps inside your own apps, approvals you can prove, agents with a person in the loop, an integration hub — and a home for workflows moving off SharePoint, Nintex or K2.
            </SectionHeading>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map((useCase) => <UseCaseCard key={useCase.slug} useCase={useCase} />)}
              <Link href="/use-cases" className="flex flex-col justify-center rounded-2xl border border-dashed border-[#1B1916]/15 p-6 text-center hover:border-[#8A6D45]/40">
                <span className="font-[family-name:var(--font-display)] text-xl font-bold">All use cases</span>
                <span className="mt-2 inline-flex items-center justify-center gap-1 text-sm font-semibold text-[#8A6D45]">Browse them <ArrowRight size={14} aria-hidden="true" /></span>
              </Link>
            </div>
          </div>
        </section>

        {/* Package gallery */}
        <section id="gallery" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <GalleryTeaser />
          </div>
        </section>

        {/* CLI */}
        <section id="cli" className="scroll-mt-8 border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="Everything from the CLI" title="Create, update, delete and monitor — from your terminal or CI.">
              <code className="font-mono text-base">usertasks</code> talks only to the public API, so it obeys the same permissions as any client. Log in with your browser or an API key, keep profiles for dev and prod, and pipe JSON into the rest of your tools.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2">
              {CLI_EXAMPLES.map((example) => (
                <div key={example.verb} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A6D45]">{example.verb}</p>
                  <h3 className="mt-1 text-lg font-semibold">{example.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#4A463E]">{example.body}</p>
                  <div className="mt-4"><Snippet code={example.code} /></div>
                </div>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <figure>
                <Shot name="cli-edit-workflow" alt="Terminal output of exporting, updating and publishing a workflow with the usertasks CLI" sizes="(min-width: 1024px) 540px, 100vw" />
                <figcaption className="mt-2 text-sm text-[#6E6759]">Real output: edit a workflow as a file and publish it.</figcaption>
              </figure>
              <figure>
                <Shot name="cli-logs-tail" alt="Terminal output of usertasks logs tail streaming live workflow events" sizes="(min-width: 1024px) 540px, 100vw" />
                <figcaption className="mt-2 text-sm text-[#6E6759]">Real output: <code className="font-mono">logs tail</code> following runs as they happen.</figcaption>
              </figure>
            </div>
            <p className="mt-8 text-sm text-[#4A463E]">
              <Link href="/docs/cli" className="font-semibold text-[#8A6D45] hover:underline">CLI guide</Link>{" · "}
              <Link href="/docs/cli/commands" className="font-semibold text-[#8A6D45] hover:underline">Every command</Link>{" · "}
              <Link href="/docs/cli/recipes" className="font-semibold text-[#8A6D45] hover:underline">Recipes: dev → prod, CI, monitoring</Link>
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
              <li key={destination.name} className="rounded-xl border border-[#1B1916]/10 bg-[#FFFFFF]/70 px-4 py-2.5">
                <span className="block text-sm font-semibold">{destination.name}</span>
                <span className="block text-xs text-[#6E6759]">{destination.note}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-[3fr_2fr]">
            <Shot name="log-export" alt="Settings, Log Export page listing a Splunk HEC destination and a webhook destination with healthy status and lag" sizes="(min-width: 1024px) 650px, 100vw" />
            <div className="space-y-4">
              <Shot name="cli-log-destinations" alt="Terminal output creating a Splunk destination from a file and checking its status" sizes="(min-width: 1024px) 430px, 100vw" />
              <ul className="space-y-2 text-sm text-[#4A463E]">
                {["Filters by category, type glob, severity and workflow", "Send-test button, lag and last-error per destination", "Pull API with a cursor and an SSE stream for your own consumers"].map((item) => (
                  <li key={item} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[#4F7A5B]" aria-hidden="true" />{item}</li>
                ))}
              </ul>
              <Link href="/docs/observability" className="inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline">Observability guide <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="The engine" title="Everything a real process needs, nothing it doesn't." />
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body, href, shot }) => (
                <Link key={title} href={href} className="group flex flex-col overflow-hidden rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] transition hover:border-[#8A6D45]/40 hover:shadow-md">
                  {shot ? (
                    <div className="aspect-[16/10] overflow-hidden border-b border-[#1B1916]/[0.06] bg-[#FFFFFF]">
                      <Image src={SCREENSHOTS[shot]} alt="" sizes="(min-width: 1024px) 360px, (min-width: 768px) 50vw, 100vw" placeholder="blur" className="h-full w-full object-cover object-left-top" />
                    </div>
                  ) : (
                    <div className="flex aspect-[16/10] items-center justify-center border-b border-[#1B1916]/[0.06] bg-gradient-to-br from-[#17150F]/[0.06] to-[#B08A54]/[0.12]">
                      <Icon size={40} className="text-[#8A6D45]" aria-hidden="true" />
                    </div>
                  )}
                  <div className="p-5">
                    <h3 className="flex items-center gap-2 text-lg font-semibold"><Icon size={17} className="text-[#8A6D45]" aria-hidden="true" />{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#4A463E]">{body}</p>
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
              <Link href="/docs/config-as-code" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline"><GitBranch size={14} aria-hidden="true" /> Config as code and GitHub sync</Link>
            </div>
            <Shot name="cli-config-diff" alt="Terminal output of usertasks config export and config diff" sizes="(min-width: 1024px) 540px, 100vw" />
          </div>
        </section>

        {/* Performance */}
        <section className="border-y border-[#1B1916]/[0.07] bg-[#17150F] text-[#EDE8DC]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#E2C9A0]">Performance</p>
            <h2 className="mt-3 max-w-3xl font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-5xl" style={{ color: "#FAF8F3" }}>A fast execution engine.</h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-[#D8D1C2]">
              Single-digit-millisecond API and MCP calls, a queue that clears hundreds of runs a second, and expressions evaluated in about a microsecond — so the engine is never the slow step in your process.
            </p>
            <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {PERF.map((item) => (
                <div key={item.label} className="flex flex-col-reverse justify-end rounded-xl border border-white/10 p-5">
                  <dt className="mt-2 text-sm leading-5 text-[#B9B2A3]">{item.label}</dt>
                  <dd className="font-[family-name:var(--font-display)] text-3xl font-bold text-[#FAF8F3]">{item.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-3xl text-xs leading-5 text-[#B9B2A3]">
              Medians measured on our benchmark (app and database on one machine). Your numbers depend on network and hosting — <Link href="/docs/performance" className="font-semibold text-[#E2C9A0] hover:underline">see /docs/performance</Link>.
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
              <div key={title} className="flex flex-col rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/60 p-6">
                <Icon size={22} className="text-[#8A6D45]" aria-hidden="true" />
                <h3 className="mt-3 text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#4A463E]">{body}</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-[#4A463E]">
                  {points.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[#4F7A5B]" aria-hidden="true" />{point}</li>)}
                </ul>
                <Link href={href} className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline">{cta} <ArrowRight size={14} aria-hidden="true" /></Link>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-[#1B1916]/10 bg-gradient-to-br from-[#17150F]/[0.06] via-transparent to-[#B08A54]/[0.12] p-8 text-center sm:p-14">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">Start with the docs. Ship with the CLI.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-[#4A463E]">Every node, function, permission, MCP tool and command is documented — generated from the code, so it matches what you run.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/docs" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Documentation <ArrowRight size={16} aria-hidden="true" /></Link>
              {repoUrl && <a href={repoUrl} className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">GitHub</a>}
              <Link href="/login" className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Sign in</Link>
            </div>
            {!repoUrl && <p className="mt-6 text-sm text-[#6E6759]">{SOURCE_RELEASE_NOTE}</p>}
          </div>
        </section>
      </main>

      <footer className="border-t border-[#1B1916]/[0.07]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Wordmark size={26} />
          <p className="text-xs text-[#857D6D]">Open-source headless workflow engine · Apache-2.0 · © {new Date().getFullYear()} UserTasks</p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[#6E6759]">
            <Link href="/use-cases" className="hover:text-[#1B1916]">Use cases</Link>
            <Link href="/forms" className="hover:text-[#1B1916]">Forms</Link>
            <Link href="/documents" className="hover:text-[#1B1916]">Documents</Link>
            <Link href="/gallery" className="hover:text-[#1B1916]">Package gallery</Link>
            <Link href="/deploy-anywhere" className="hover:text-[#1B1916]">Deploy anywhere</Link>
            <Link href="/docs" className="hover:text-[#1B1916]">Docs</Link>
            <Link href="/docs/api-explorer" className="hover:text-[#1B1916]">API Explorer</Link>
            <Link href="/open-source" className="hover:text-[#1B1916]">Why open source</Link>
            <Link href="/contact" className="hover:text-[#1B1916]">Contact</Link>
            <Link href="/login" className="hover:text-[#1B1916]">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
