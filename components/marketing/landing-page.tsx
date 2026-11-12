import type { CSSProperties, ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight, Bell, Bot, Check, Cloud, Container, FileSpreadsheet, GitFork, Mail, MessageCircle, Play, Plug, Server, ShieldCheck, Sparkles, StickyNote, Terminal, WifiOff,
} from "lucide-react"
import { FaqList, MarketingFooter, MarketingHeader, SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { NavArt } from "@/components/marketing/nav-art"
import { ProductDemo } from "@/components/marketing/demo/product-demo"
import { LazyAgentChat } from "@/components/marketing/demo/lazy-demo"
import { RevealRoot } from "@/components/marketing/reveal-root"
import { ScreenshotFrame } from "@/components/marketing/screenshot-frame"
import { Testimonials } from "@/components/marketing/testimonials"
import { aiConnectors, CONNECTOR_COUNT, connectorGroups, shortProviderName, WORKFLOW_NODE_COUNT } from "@/lib/marketing-connectors"
import { PRODUCT_TILES, SOLUTIONS_BY_TEAM, SOLUTIONS_BY_USE_CASE, START_HREF } from "@/lib/marketing-nav"
import { GALLERY_PACKAGES } from "@/lib/gallery/site"
import { ASSISTANT_PROVIDERS, PROVIDER_PRESETS } from "@/lib/assistants/types"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import type { ScreenshotName } from "@/lib/docs/screenshot-names"
import { CLI_PACKAGE, repositoryUrl, SOURCE_RELEASE_NOTE } from "@/lib/site-links"

/**
 * The cloud edition's homepage. Server-rendered; client islands are the
 * header, the hero demo (ProductDemo), the lazy Agent chat and the copy
 * buttons. Brand: cream paper and ink with bronze, on dark "night" stages for
 * the hero, the Agent and the closing call to action.
 */

const THEME = {
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

export const HOME_FAQS = [
  { question: "What is UserTasks?", answer: "An open-source platform for the work between people and systems: forms that collect requests, workflows that route them, a task list where people approve and complete them, data tables and reports over the results, and an AI Agent on every screen that helps build and work all of it." },
  { question: "Is it really open source?", answer: "Yes. UserTasks is licensed under Apache-2.0. The cloud edition at usertasks.com runs the same code, and config as code lets you move a workspace between the cloud and your own servers." },
  { question: "Do I have to use AI?", answer: "No. The Agent and AI workflow steps are optional and off until an administrator turns them on with your own provider key: OpenAI, Claude, Gemini, Grok, Azure OpenAI, Mistral, Groq, Ollama or any OpenAI-compatible model. The Agent proposes; people apply and confirm." },
  { question: "Where does our data live?", answer: "In the cloud edition, in an isolated workspace. Self-hosted, wherever you put it: start on Supabase, or run the database, storage, auth, email and secrets on AWS, Azure, Google Cloud, Kubernetes or your own servers, including air-gapped networks." },
  { question: "Can developers drive it from code?", answer: "Every screen is backed by the REST API, described by OpenAPI 3.1. There is an MCP server for AI clients, a TypeScript SDK and the usertasks CLI, with config as code to review and promote changes like any other code." },
  { question: "What does it cost?", answer: "The cloud edition is free during the beta, with no credit card. Self-hosting is free under the Apache-2.0 licence. Talk to us about support and private deployments." },
]

/** Email + "Start free": a plain GET to /start, so it works before (and without) JavaScript. */
function StartForm({ id, tone = "night" }: { id: string; tone?: "night" | "paper" }) {
  return (
    <form action={START_HREF} method="get" className="w-full max-w-md">
      <div className={`flex flex-col gap-2 rounded-2xl p-1.5 sm:flex-row ${tone === "night" ? "border border-white/15 bg-[#fff]/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur" : "border border-(color:--mkt-ink)/12 bg-(color:--mkt-white) shadow-sm"}`}>
        <label htmlFor={id} className="sr-only">Work email</label>
        <input
          id={id}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          className={`min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 text-base outline-none ${tone === "night" ? "text-white placeholder:text-[#A89E8C] focus-visible:bg-[#fff]/[0.05]" : "text-(color:--mkt-ink) placeholder:text-(color:--mkt-subtle)"}`}
          style={{ backgroundColor: "transparent" }}
        />
        <button type="submit" className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 py-3 font-semibold ${tone === "night" ? "mkt-btn-ember" : "mkt-btn-primary"}`}>
          Start free <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}

function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <p className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] ${light ? "text-[#F0C27B]" : "text-(color:--mkt-bronze)"}`}><span aria-hidden="true" className={`h-px w-6 bg-gradient-to-r from-transparent ${light ? "to-[#F0C27B]" : "to-(color:--mkt-gold)"}`} />{children}</p>
}

/* ── The "before" mess ─────────────────────────────────────────────── */
function MessyBefore() {
  const scraps: Array<{ icon: typeof Mail; title: string; body: string; style: CSSProperties; tone: string }> = [
    { icon: Mail, title: "RE: RE: FW: laptop for new designer??", body: "Did this ever get approved? Finance says they never saw it…", style: { top: "4%", left: "2%", rotate: "-4deg" }, tone: "bg-(color:--mkt-white)" },
    { icon: FileSpreadsheet, title: "purchase_requests_v7_FINAL(2).xlsx", body: "Row 214 · status: “waiting?” · owner: ??", style: { top: "30%", left: "30%", rotate: "3deg" }, tone: "bg-[#EEF6EE]" },
    { icon: MessageCircle, title: "#design-team", body: "@priya can you chase finance on the MacBook pls 🙏", style: { top: "56%", left: "4%", rotate: "-2deg" }, tone: "bg-(color:--mkt-white)" },
    { icon: StickyNote, title: "Note to self", body: "Chase PO on Thursday. Who has the quote?", style: { top: "62%", left: "52%", rotate: "6deg" }, tone: "bg-[#FFF3C4]" },
  ]
  return (
    <div className="relative h-[340px] sm:h-[380px]" aria-hidden="true">
      {scraps.map(({ icon: Icon, title, body, style, tone }) => (
        <div key={title} className={`absolute w-[64%] rounded-xl border border-(color:--mkt-ink)/10 p-3.5 shadow-[0_14px_30px_-16px_rgba(27,25,22,0.4)] sm:w-[58%] ${tone}`} style={style}>
          <p className="flex items-center gap-2 truncate text-[13px] font-semibold text-(color:--mkt-ink)"><Icon size={14} className="shrink-0 text-(color:--mkt-muted)" />{title}</p>
          <p className="mt-1 text-xs leading-5 text-(color:--mkt-muted)">{body}</p>
        </div>
      ))}
      <span className="absolute right-[4%] top-[14%] rotate-[8deg] rounded-full bg-(color:--mkt-red) px-3 py-1 text-xs font-bold text-white shadow-lg">9 days · 14 emails</span>
    </div>
  )
}

function CleanAfter() {
  const steps = [["Submitted", true], ["Budget", true], ["Manager", true], ["Finance", false], ["Order", null]] as const
  return (
    <div className="mkt-ring relative overflow-hidden p-5 shadow-[0_30px_60px_-30px_rgba(27,25,22,0.35)]" aria-hidden="true">
      <p className="text-[13px] text-(color:--mkt-muted)">PUR-1042 · Purchase request</p>
      <p className="mt-0.5 font-semibold">Approve purchase: MacBook Pro ($4,200)</p>
      <ol className="mt-5 flex items-center">
        {steps.map(([label, done], index) => (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <span className="flex flex-col items-center gap-1.5">
              <span className={`flex size-8 items-center justify-center rounded-full text-white ${done ? "bg-(color:--mkt-green)" : done === false ? "mkt-pulse-dot bg-[#E8B266] text-[#1B1406]" : "bg-(color:--mkt-line-strong)"}`}>
                {done ? <Check size={15} strokeWidth={3} /> : <span className="text-xs font-bold">{index + 1}</span>}
              </span>
              <span className="text-[11px] font-medium text-(color:--mkt-text)">{label}</span>
            </span>
            {index < steps.length - 1 && <span className={`mx-1 mb-5 h-0.5 flex-1 rounded ${done ? "bg-(color:--mkt-green)" : "bg-(color:--mkt-line-strong)"}`} />}
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl bg-(color:--mkt-sand) px-3 py-2.5 text-[13px]">
        <Bell size={14} className="text-(color:--mkt-bronze)" />Waiting on <b>Finance</b> · reminder tomorrow 09:00 · due Wed
      </div>
    </div>
  )
}

/* ── Big feature sections ─────────────────────────────────────────────── */
type Feature = { zoom?: { scale: number; origin: string }; insetZoom?: { scale: number; origin: string }; id: string; eyebrow: string; title: ReactNode; body: string; points: string[]; href: string; cta: string; shot: ScreenshotName; alt: string; inset: ScreenshotName; insetAlt: string; stat: { value: string; label: string } }

const FEATURES: Feature[] = [
  {
    id: "workflows", zoom: { scale: 1.9, origin: "50% 28%" }, insetZoom: { scale: 1.6, origin: "45% 40%" }, eyebrow: "Workflows", title: <>Processes you can <span className="mkt-gradient-text-ink">actually see.</span></>,
    body: "Draw the process on a canvas, or let the Agent draw it. Every run shows the path it took, who has it now and what happens next, so nobody has to ask where things are.",
    points: ["Branches, parallel paths, loops, sub-workflows, timers and error paths", "Decision tables your analysts change without touching the flow", "Save & Test with the real forms; versions and live migration"],
    href: "/workflows", cta: "Explore workflows", shot: "workflows-process-viewer", alt: "The process view of a completed supplier invoice run: the path through the approval policy, the finance manager approval and both parallel branches, with steps that did not run greyed out",
    inset: "workflows-designer", insetAlt: "The workflow designer with a supplier invoice workflow and the Branch by Value settings open", stat: { value: String(WORKFLOW_NODE_COUNT), label: "kinds of workflow step" },
  },
  {
    id: "forms", eyebrow: "Forms", title: <>Forms that do <span className="mkt-gradient-text-ink">the typing for you.</span></>,
    body: "Lay out a form on a grid, or answer a few questions and let the wizard write it. Lists for line items, lookups into your data, rules that show, fill and total fields, then share it as a link, an embed or a QR code.",
    points: ["Lists, lookups, attachments, signatures and survey controls", "Rules, buttons and steps; your own controls as web components", "Every value checked on the server and ready for the workflow"],
    href: "/forms", cta: "Explore forms", shot: "forms-designer", alt: "The form designer with a vendor application form on four steps, the field palette on the left and the field settings on the right",
    inset: "forms-page", insetAlt: "A published form page with a header, a customer lookup and three uploaded files", stat: { value: "1", label: "description, to a form and its workflow" },
  },
  {
    id: "tasks", zoom: { scale: 1.35, origin: "0% 0%" }, insetZoom: { scale: 1.5, origin: "40% 0%" }, eyebrow: "Tasks and approvals", title: <>Approvals that <span className="mkt-gradient-text-ink">chase themselves.</span></>,
    body: "Everything someone needs to do lands in one task list, on desktop or phone. Approve with a comment, hand it on, act on behalf of a colleague, or pick work from a team queue. Reminders and escalation do the chasing.",
    points: ["Approve, reject, request changes, redirect or act on behalf", "Team queues with rules, SLAs, reminders and escalation", "A timeline and audit trail on every request"],
    href: "/tasks-and-approvals", cta: "Explore tasks", shot: "tasks-queue", alt: "The task queue with queued tasks waiting to be accepted by members of the team",
    inset: "task-detail", insetAlt: "A task with its form, outcome buttons and details", stat: { value: "1", label: "task list for every process" },
  },
]

function FeatureSection({ feature, flip }: { feature: Feature; flip: boolean }) {
  return (
    <div id={feature.id} className="scroll-mt-24 grid items-center gap-10 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:py-24">
      <div className={flip ? "lg:order-2" : ""} data-reveal>
        <Eyebrow>{feature.eyebrow}</Eyebrow>
        <h3 className="mt-3 font-display text-3xl font-bold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.08]">{feature.title}</h3>
        <p className="mt-4 mkt-body text-(color:--mkt-text)">{feature.body}</p>
        <ul className="mt-6 space-y-2.5 text-[15px] text-(color:--mkt-ink-soft)">
          {feature.points.map((point) => <li key={point} className="flex gap-3"><span className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-green) text-white"><Check size={10} strokeWidth={3.5} aria-hidden="true" /></span>{point}</li>)}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-6">
          <Link href={feature.href} className="group inline-flex items-center gap-1.5 rounded-xl border border-(color:--mkt-ink)/15 bg-(color:--mkt-white) px-4 py-2.5 text-sm font-semibold hover:border-(color:--mkt-ink)/35">{feature.cta} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></Link>
          <p className="flex items-baseline gap-2"><span className="font-display text-4xl font-bold">{feature.stat.value}</span><span className="max-w-[10rem] text-sm leading-5 text-(color:--mkt-muted)">{feature.stat.label}</span></p>
        </div>
      </div>
      <div className={`relative ${flip ? "lg:order-1" : ""}`} data-reveal>
        <div className="mkt-glow">
          <ScreenshotFrame>
            <div className="aspect-[16/10] overflow-hidden bg-(color:--mkt-white)">
              <Image src={SCREENSHOTS[feature.shot]} alt={feature.alt} sizes="(min-width: 1152px) 1100px, 100vw" placeholder="blur" className="h-full w-full object-cover object-left-top" style={feature.zoom ? { transform: `scale(${feature.zoom.scale})`, transformOrigin: feature.zoom.origin } : undefined} />
            </div>
          </ScreenshotFrame>
        </div>
        <div className={`absolute -bottom-10 hidden w-[46%] sm:block ${flip ? "-right-6" : "-left-6"}`}>
          <ScreenshotFrame className="shadow-[0_30px_60px_-20px_rgba(27,25,22,0.45)]">
            <div className="aspect-[16/10] overflow-hidden bg-(color:--mkt-white)">
              <Image src={SCREENSHOTS[feature.inset]} alt={feature.insetAlt} sizes="600px" placeholder="blur" className="h-full w-full object-cover object-left-top" style={feature.insetZoom ? { transform: `scale(${feature.insetZoom.scale})`, transformOrigin: feature.insetZoom.origin } : undefined} />
            </div>
          </ScreenshotFrame>
        </div>
      </div>
    </div>
  )
}

const DEPLOY = [
  { icon: Cloud, title: "Cloud", body: "Start in the browser at usertasks.com. We run and upgrade it.", href: "/docs/quickstart/cloud" },
  { icon: Container, title: "Docker", body: "One image and Supabase, on any server, in about ten minutes.", href: "/docs/quickstart/self-host" },
  { icon: Server, title: "Kubernetes", body: "Your cluster on AWS, Azure, Google Cloud or on premises.", href: "/docs/self-hosting/kubernetes" },
  { icon: WifiOff, title: "Air-gapped", body: "No outbound calls: local models, mirrored images, your own services.", href: "/docs/self-hosting/air-gapped" },
]

export function LandingPage() {
  // Null until the public repository exists: repository links are omitted.
  const repoUrl = repositoryUrl()
  const connectors = connectorGroups().flatMap((group) => group.connectors.map((connector) => connector.name))
  const ai = aiConnectors().map((provider) => shortProviderName(provider.name))
  const half = Math.ceil(connectors.length / 2)
  const rows = [connectors.slice(0, half), [...connectors.slice(half), ...ai]]
  const packagesIn = (href: string) => GALLERY_PACKAGES.filter((pkg) => href.endsWith(`=${pkg.category}`)).length

  return (
    <div className="mkt min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <RevealRoot />
      <MarketingHeader tone="night" />

      <main>
        {/* ── Hero ── */}
        <section data-hero-night className="mkt-night mkt-grain relative overflow-hidden">
          <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
          <div aria-hidden="true" className="pointer-events-none absolute -top-48 left-1/2 h-[42rem] w-[72rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.30),transparent)]" />
          <div aria-hidden="true" className="pointer-events-none absolute right-[-12rem] top-[28rem] h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(139,124,246,0.22),transparent)]" />
          <div aria-hidden="true" className="pointer-events-none absolute left-[-14rem] top-[40rem] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(79,179,169,0.16),transparent)]" />

          <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-12 text-center sm:px-6 sm:pt-16">
            <Link href="/open-source" className="group inline-flex items-center gap-2 rounded-full border border-white/12 bg-[#fff]/[0.05] py-1 pl-1 pr-3 text-[13px] text-[#E9E1D2] backdrop-blur hover:border-white/25">
              <span className="rounded-full bg-[#fff]/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#F0C27B]">Open source</span>
              Apache-2.0<span className="hidden sm:inline">· in our cloud or on your servers</span>
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <h1 className="mx-auto mt-6 max-w-4xl font-display text-[clamp(2.75rem,6.6vw,5.25rem)] font-bold leading-[0.98] tracking-[-0.03em] text-white">
              The open source<br /><span className="mkt-gradient-text">process platform.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[18px] leading-8 text-[#D9D0BF] sm:text-[19px]">
              UserTasks turns the forms, approvals and hand-offs between your people and systems into one flow everyone can see. Describe it to the Agent and it is built in minutes.
            </p>
            <div className="mt-8 flex flex-col items-center gap-4">
              <StartForm id="hero-email" />
              <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-[#A89E8C]">
                <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-[#7FA98A]" aria-hidden="true" />Free during the beta</span>
                <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-[#7FA98A]" aria-hidden="true" />No credit card</span>
                <a href="#demo" className="inline-flex items-center gap-1.5 font-semibold text-[#F0C27B] hover:text-white"><Play size={12} className="fill-current" aria-hidden="true" />Try the demo below</a>
              </p>
            </div>
          </div>

          <div className="relative mx-auto max-w-6xl px-3 pb-20 sm:px-6 sm:pb-28">
            <ProductDemo />
          </div>
        </section>

        {/* ── Proof bar ── */}
        <section aria-label="At a glance" className="border-b border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/60">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-5">
            {[
              ["Unlimited", "possibilities: build any process your team runs"],
              ["<1 ms", "median time to run a workflow step (measured on live runs)"],
              ["∞", "use cases: approvals, onboarding, purchasing, IT and beyond"],
              ["4", "ways to run it: cloud, Docker, Kubernetes, air-gapped"],
              ["Apache-2.0", "open source, no lock-in"],
            ].map(([value, label]) => (
              <div key={label} className="flex flex-col-reverse gap-1 py-8 pr-4 last:col-span-2 lg:last:col-span-1" data-reveal>
                <dt className="text-sm leading-5 text-(color:--mkt-muted)">{label}</dt>
                <dd className="whitespace-nowrap font-display text-4xl font-bold tracking-tight">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Before / after ── */}
        <section className="relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <SectionHeading eyebrow="Why it exists" title={<>Approvals shouldn’t live in <span className="mkt-gradient-text-ink">inboxes.</span></>} align="center">
              Requests arrive by email, sit in spreadsheets and move when someone remembers to chase. UserTasks gives each one a form, a path and an owner.
            </SectionHeading>
            <div className="mt-14 grid items-center gap-8 lg:grid-cols-[1fr_auto_1fr] [&>*]:min-w-0">
              <div data-reveal>
                <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-red)">Before</p>
                <MessyBefore />
              </div>
              <div aria-hidden="true" className="mx-auto flex size-14 items-center justify-center rounded-full border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) shadow-lg lg:rotate-0" data-reveal>
                <ArrowRight size={22} className="rotate-90 text-(color:--mkt-bronze) lg:rotate-0" />
              </div>
              <div data-reveal>
                <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-green)">With UserTasks</p>
                <CleanAfter />
                <ul className="mt-6 grid gap-2 text-[15px] text-(color:--mkt-ink-soft) sm:grid-cols-2">
                  {["Everyone sees where it is", "Reminders do the chasing", "Every decision on the record", "Systems updated automatically"].map((item) => <li key={item} className="flex items-center gap-2"><Check size={16} className="text-(color:--mkt-green)" aria-hidden="true" />{item}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Pillars ── */}
        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/60">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
            <SectionHeading eyebrow="One platform" title="Everything between the request and the result." align="center">
              Six parts that share one data model, one permission system and one Agent.
            </SectionHeading>
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {PRODUCT_TILES.map((tile) => (
                <li key={tile.href} data-reveal>
                  <Link href={tile.href} className="mkt-lift group flex h-full flex-col rounded-3xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-3 hover:border-(color:--mkt-bronze)/40">
                    <NavArt kind={tile.art} live className="h-36" />
                    <span className="px-3 pb-3 pt-5">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">{tile.title}</span>
                      <span className="mt-1.5 block font-display text-[1.6rem] font-bold leading-tight tracking-tight">{tile.outcome}</span>
                      <span className="mt-2 block text-sm leading-6 text-(color:--mkt-text)">{tile.description}</span>
                      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-ink)">Learn more <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" aria-hidden="true" /></span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Three big features ── */}
        <section id="forms-and-tasks" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl divide-y divide-(color:--mkt-ink)/[0.07] px-4 sm:px-6">
            {FEATURES.map((feature, index) => <FeatureSection key={feature.id} feature={feature} flip={index % 2 === 1} />)}
          </div>
        </section>

        {/* ── Agent spotlight ── */}
        <section id="agent" className="mkt-night mkt-grain relative scroll-mt-20 overflow-hidden">
          <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
          <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-0 h-[40rem] w-[40rem] rounded-full bg-[radial-gradient(closest-side,rgba(139,124,246,0.28),transparent)]" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-40 bottom-0 h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.22),transparent)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:py-32 [&>*]:min-w-0">
            <div data-reveal>
              <Eyebrow light>The UserTasks Agent</Eyebrow>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl sm:leading-[1.05]">An Agent that <span className="mkt-gradient-text">asks before it acts.</span></h2>
              <p className="mt-5 text-[17px] leading-8 text-[#D9D0BF]">One panel on every screen. It reads what you are looking at, answers, drafts and builds, and anything that changes data comes to you as a card to apply or confirm. It works with your permissions, on your own model.</p>
              <ul className="mt-8 space-y-4">
                {[
                  [Sparkles, "Builds from a description", "Tables, forms, workflows and reports from one paragraph, as drafts."],
                  [Bot, "Works tasks with you", "Summarises, drafts comments, approves when you confirm."],
                  [ShieldCheck, "Governed", "Your permissions, daily limits and cost caps, all in the audit trail."],
                ].map(([Icon, title, body]) => {
                  const I = Icon as typeof Bot
                  return (
                    <li key={title as string} className="flex gap-4">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#fff]/[0.06] text-[#F0C27B]"><I size={18} aria-hidden="true" /></span>
                      <span><b className="block text-white">{title as string}</b><span className="text-sm leading-6 text-[#C9BFAE]">{body as string}</span></span>
                    </li>
                  )
                })}
              </ul>
              <ul className="mt-8 flex flex-wrap gap-2" aria-label="Model providers the Agent can use">
                {ASSISTANT_PROVIDERS.map((id) => <li key={id} className={`rounded-full px-3 py-1 text-xs font-medium ${id === "other" ? "border border-dashed border-white/20 text-[#C9BFAE]" : "border border-white/12 text-[#E9E1D2]"}`}>{id === "other" ? "Any OpenAI-compatible model" : PROVIDER_PRESETS[id].label}</li>)}
              </ul>
              <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <Link href="/ai-assistants" className="inline-flex items-center gap-1 font-semibold text-[#F0C27B] hover:text-white">Meet the Agent <ArrowRight size={14} aria-hidden="true" /></Link>
                <Link href="/docs/tutorials/agent-build-from-process" className="inline-flex items-center gap-1 font-semibold text-[#F0C27B] hover:text-white">Tutorial: build from a process <ArrowRight size={14} aria-hidden="true" /></Link>
              </p>
            </div>
            <div className="mkt-glow" data-reveal>
              <LazyAgentChat />
            </div>
          </div>
        </section>

        {/* ── Built for ── */}
        <section id="use-cases" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <SectionHeading eyebrow="Built for" title="Every team has a process like this." align="center">
              Start from a ready-made package for your team, or from a use case, and change anything.
            </SectionHeading>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {SOLUTIONS_BY_TEAM.map((team) => {
                const count = packagesIn(team.href)
                return (
                  <li key={team.href} data-reveal>
                    <Link href={team.href} className="mkt-lift group flex h-full flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5 hover:border-(color:--mkt-bronze)/40">
                      <span className="font-display text-xl font-bold leading-tight">{team.title}</span>
                      <span className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{team.description}</span>
                      {count > 0 && <span className="mt-4 text-xs font-semibold text-(color:--mkt-bronze)">{count} ready-made packages <ArrowRight size={12} className="inline transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SOLUTIONS_BY_USE_CASE.map((useCase) => (
                <li key={useCase.href} data-reveal>
                  <Link href={useCase.href} className="group flex items-center justify-between gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) px-5 py-4 hover:border-(color:--mkt-bronze)/40 hover:bg-(color:--mkt-white)">
                    <span><span className="block font-semibold">{useCase.title}</span><span className="text-sm text-(color:--mkt-muted)">{useCase.description}</span></span>
                    <ArrowRight size={16} className="shrink-0 text-(color:--mkt-bronze) transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-center"><Link href="/use-cases" className="inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">All use cases <ArrowRight size={14} aria-hidden="true" /></Link></p>
          </div>
        </section>

        <Testimonials />

        {/* ── Integrations ── */}
        <section id="integrations" className="scroll-mt-20 border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/60">
          <div className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-24">
            <SectionHeading eyebrow="Integrations" title="Systems that finally talk." align="center">
              {CONNECTOR_COUNT} ready-made connectors, any REST or OData API through OpenAPI import, databases, webhooks and MCP in both directions.
            </SectionHeading>
          </div>
          <div className="mkt-marquee-wrap mkt-marquee-mask mt-12 space-y-3 overflow-hidden" aria-label="Connectors">
            {rows.map((row, rowIndex) => (
              <div key={rowIndex} className="mkt-marquee gap-3" style={{ "--marquee-duration": `${70 + rowIndex * 15}s`, animationDirection: rowIndex % 2 ? "reverse" : "normal" } as CSSProperties}>
                {[...row, ...row].map((name, index) => (
                  <span key={`${name}-${index}`} aria-hidden={index >= row.length ? "true" : undefined} className="whitespace-nowrap rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) px-4 py-2.5 text-sm font-semibold text-(color:--mkt-ink-soft) shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]">{name}</span>
                ))}
              </div>
            ))}
          </div>
          <div className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 pt-12 sm:px-6 md:grid-cols-3 sm:pb-24">
            {[
              [Plug, "Any API", "Import an OpenAPI or Postman file: one reference per operation, with a data picker for the response.", "/docs/integrations/openapi-import"],
              [Bot, "MCP, both ways", "Claude, ChatGPT and Cursor drive UserTasks through its MCP server; your MCP servers become tools for agents.", "/docs/mcp"],
              [Terminal, "API, SDK and CLI", "Every screen is an endpoint. Script it with the TypeScript SDK or the usertasks CLI.", "/docs/api"],
            ].map(([Icon, title, body, href]) => {
              const I = Icon as typeof Plug
              return (
                <Link key={title as string} href={href as string} className="mkt-lift group rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6 hover:border-(color:--mkt-bronze)/40" data-reveal>
                  <I size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                  <span className="mt-3 block text-lg font-semibold">{title as string}</span>
                  <span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{body as string}</span>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze)">Read more <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
                </Link>
              )
            })}
          </div>
        </section>

        {/* ── Deploy anywhere + open source ── */}
        <section id="deploy" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <SectionHeading eyebrow="Deploy anywhere" title="Our cloud, or anywhere you like." align="center">
              The same code everywhere. Move a workspace between them with config as code.
            </SectionHeading>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {DEPLOY.map(({ icon: Icon, title, body, href }) => (
                <li key={title} data-reveal>
                  <Link href={href} className="mkt-lift group flex h-full flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6 hover:border-(color:--mkt-bronze)/40">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2A251E] to-[#14110D] text-[#F0C27B] shadow-lg"><Icon size={22} aria-hidden="true" /></span>
                    <span className="mt-5 text-lg font-semibold">{title}</span>
                    <span className="mt-1 flex-1 text-sm leading-6 text-(color:--mkt-text)">{body}</span>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze)">Guide <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
                  </Link>
                </li>
              ))}
            </ul>

            <div id="open-source" className="mkt-night mkt-grain relative mt-16 scroll-mt-24 overflow-hidden rounded-[2rem] p-8 sm:p-12" data-reveal>
              <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
              <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.3),transparent)]" />
              <div className="relative grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
                <div>
                  <Eyebrow light>Open source</Eyebrow>
                  <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-white">Yours to read, run and change.</h2>
                  <p className="mt-4 text-[17px] leading-8 text-[#D9D0BF]">Apache-2.0, with nothing held back for a paid tier. Read every line, run it on your own servers and keep your processes if you ever leave the cloud.</p>
                  <div className="mt-7 flex flex-wrap gap-3">
                    <Link href="/open-source" className="mkt-btn-ember inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold">Why open source <ArrowRight size={16} aria-hidden="true" /></Link>
                    {repoUrl && <a href={repoUrl} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 font-semibold text-[#F4EFE4] hover:border-white/35"><GitFork size={16} aria-hidden="true" />GitHub</a>}
                  </div>
                  {!repoUrl && <p className="mt-5 text-sm text-[#C9BFAE]">{SOURCE_RELEASE_NOTE}</p>}
                </div>
                <div className="space-y-3">
                  <Snippet code={`npm install -g ${CLI_PACKAGE}\nusertasks login\nusertasks workflows list`} />
                  <p className="text-sm text-[#C9BFAE]"><code className="font-mono">usertasks login</code> connects to your local install at http://localhost:3000. Then the <Link href="/docs/cli" className="font-semibold text-[#F0C27B] hover:text-white">CLI guide</Link>, the <Link href="/docs/api" className="font-semibold text-[#F0C27B] hover:text-white">REST API</Link> and <Link href="/docs/config-as-code" className="font-semibold text-[#F0C27B] hover:text-white">config as code</Link>.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/50">
          <FaqList faqs={HOME_FAQS} />
        </div>

        {/* ── Closing call to action ── */}
        <section className="mkt-night mkt-grain relative overflow-hidden">
          <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[60rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.25),transparent)]" />
          <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 py-24 text-center sm:px-6 sm:py-32">
            <h2 className="font-display text-[clamp(2.5rem,6vw,4.75rem)] font-bold leading-[1] tracking-[-0.03em] text-white">The open source <span className="mkt-gradient-text">process platform.</span></h2>
            <p className="mt-5 max-w-xl text-[17px] leading-8 text-[#D9D0BF]">Your first process is a sentence away.</p>
            <div className="mt-9 flex w-full justify-center"><StartForm id="cta-email" /></div>
            <p className="mt-5 text-sm text-[#A89E8C]">Or <Link href="/contact" className="font-semibold text-[#F0C27B] hover:text-white">talk to us</Link> about a private deployment.</p>
          </div>
        </section>
      </main>

      <MarketingFooter cta={false} />
    </div>
  )
}
