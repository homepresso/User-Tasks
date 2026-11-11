import type { CSSProperties } from "react";
import Link from "next/link";
import "./marketing-tokens.css";
import {
  Workflow,
  Plug,
  ListChecks,
  Table2,
  Bot,
  BarChart3,
  Cpu,
  ArrowRight,
  Braces,
  Server,
  Code2,
  Heart,
  MinusCircle,
  CheckCircle2,
} from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/marketing-ui"

/**
 * The refocus announcement (/open-source). Announces the refocus of UserTasks into an open-source,
 * headless workflow engine. Server-rendered with no client islands. Uses the
 * same brand language as the auth layout (warm paper backdrop, Fraunces
 * headings, global glow/fade keyframes).
 */

const KEEPING = [
  {
    icon: Cpu,
    title: "Workflow engine",
    body: "The durable core: event-driven runs, branching, loops, retries, schedules, sub-workflows, and full run history.",
  },
  {
    icon: Workflow,
    title: "Workflow designer",
    body: "The visual canvas for modelling, testing, and publishing processes, so the logic never hides in code.",
  },
  {
    icon: Plug,
    title: "Integrations",
    body: "Built-in connectors plus generic REST, OData, webhooks, OpenAPI import, and OAuth 2.0 with encrypted credentials.",
  },
  {
    icon: ListChecks,
    title: "Task list",
    body: "Human steps that stay governed: assignment, SLAs, reminders, escalation, redirects, and a complete audit trail.",
  },
  {
    icon: Table2,
    title: "Decision tables",
    body: "Business rules your analysts can read and change, evaluated by the engine at every decision point.",
  },
  {
    icon: Bot,
    title: "AI agents (optional)",
    body: "Add agents with tools, knowledge, and guardrails as workflow steps when you want them. Leave them off when you don’t.",
  },
  {
    icon: BarChart3,
    title: "Reports, API, and MCP",
    body: "Built-in workflow, task, and integration reports, available through a reporting API and an MCP server for your own tools and AI clients.",
  },
];

const RETIRING = [
  "Case management",
  "Forms and page builder",
  "Kanban boards",
  "Dashboards",
  "Documents and messaging",
];

const HEADLESS_POINTS = [
  {
    icon: Braces,
    title: "API-first",
    body: "Start workflows, complete tasks, and evaluate decisions from your own applications. Bring your own UI.",
  },
  {
    icon: Server,
    title: "Run it anywhere",
    body: "Start on Supabase, our recommended platform, and move any area to AWS, Azure, Google Cloud or your own data centre whenever you're ready, fully on-premises if you need it. Your data stays where you put it.",
    href: "/deploy-anywhere",
    cta: "Deploy anywhere",
  },
  {
    icon: Code2,
    title: "Fully open source",
    body: "The whole project will be published openly. Read it, run it, extend it, and contribute back.",
  },
];

export function RefocusAnnouncement() {
  return (
    <div
      className="mkt ut-landing min-h-screen text-(color:--mkt-ink)"
      style={{
        background:
          "linear-gradient(160deg, var(--mkt-paper) 0%, var(--mkt-sand) 45%, var(--mkt-canvas) 100%)",
        // globals.css themes the whole app via unlayered --theme-* rules (h1-h4,
        // labels, selects, [class*="bg-white"] repaints…) whose :root defaults are
        // LIGHT-theme values. Like app/(auth)/layout.tsx, reset every variable here
        // — but to values matching this page's design.
        "--theme-primary": "var(--mkt-primary)",
        "--theme-primary-hover": "var(--mkt-primary-hover)",
        "--theme-primary-light": "rgba(23,21,15,0.14)",
        "--theme-card-bg": "var(--mkt-white)",
        "--theme-card-text": "var(--mkt-ink)",
        "--theme-surface": "var(--mkt-canvas)",
        "--theme-surface-border": "var(--mkt-line)",
        "--theme-muted-text": "var(--mkt-muted)",
        "--theme-sidebar-bg": "var(--mkt-paper)",
        "--theme-sidebar-text": "var(--mkt-ink)",
        "--theme-topbar": "var(--mkt-paper)",
        "--theme-topbar-text": "var(--mkt-ink)",
        "--theme-accent": "var(--mkt-primary)",
        "--theme-danger": "var(--mkt-coral)",
        "--theme-success": "var(--mkt-green-light)",
      } as CSSProperties}
    >
      <style>{`.ut-landing h1, .ut-landing h2, .ut-landing h3 { font-family: var(--font-display), ui-serif, Georgia, serif; letter-spacing: -0.015em; }`}</style>
      {/* backdrop: dot grid + glows */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(27,25,22,0.28) 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
        <div
          className="absolute -left-32 top-24 h-[560px] w-[560px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(23,21,15,0.20) 0%, transparent 70%)",
            animation: "glowPulse 6s ease-in-out infinite",
          }}
        />
        <div
          className="absolute -right-20 top-[45%] h-[480px] w-[480px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(176,138,84,0.12) 0%, transparent 70%)",
            animation: "glowPulse 8s ease-in-out 3s infinite",
          }}
        />
      </div>

      {/* ── Nav ── */}
      <MarketingHeader />

      <main className="relative z-10">
        {/* ── Announcement hero ── */}
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-24">
          <div style={{ animation: "fadeInDown 0.6s ease-out both" }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-primary)/30 bg-(color:--mkt-primary)/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">
              <Heart className="h-3.5 w-3.5" aria-hidden="true" />
              An update from the UserTasks team
            </span>
          </div>
          <h1
            className="mx-auto mt-8 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl"
            style={{ animation: "fadeInUp 0.8s ease-out 0.15s both" }}
          >
            Thank you for trying UserTasks.
          </h1>
          <p
            className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-(color:--mkt-text)"
            style={{ animation: "fadeInUp 0.8s ease-out 0.3s both" }}
          >
            Every workspace you created, every workflow you built, and every
            piece of feedback you sent helped shape what comes next. We have
            decided to strip UserTasks back to what it does best:{" "}
            <span className="font-semibold text-(color:--mkt-ink)">
              a strong workflow engine, offered as an enterprise headless
              option, and fully open source.
            </span>
          </p>
          <div
            className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            style={{ animation: "fadeInUp 0.8s ease-out 0.45s both" }}
          >
            <a
              href="#keeping"
              className="group inline-flex items-center gap-2 rounded-lg bg-(color:--mkt-primary) px-8 py-4 text-base font-semibold text-(color:--mkt-paper) shadow-lg shadow-(color:--mkt-primary)/25 transition hover:bg-(color:--mkt-primary-hover) hover:shadow-(color:--mkt-primary)/30"
            >
              See what’s changing
              <ArrowRight
                className="h-4 w-4 transition group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg border border-(color:--mkt-ink)/15 px-8 py-4 text-base font-medium text-(color:--mkt-ink-soft) transition hover:border-(color:--mkt-ink)/30 hover:bg-[rgba(67,62,60,0.05)]"
            >
              Talk to us
            </Link>
          </div>
        </section>

        {/* ── What we're keeping ── */}
        <section
          id="keeping"
          className="mx-auto max-w-6xl scroll-mt-24 px-6 py-16"
        >
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">
              What we’re keeping
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              A focused core, built to be relied on
            </h2>
            <p className="mt-4 leading-relaxed text-(color:--mkt-text)">
              These are the parts that carry real processes. They get all of
              our attention from here on.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {KEEPING.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper)/60 p-6"
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: "rgba(23,21,15,0.10)" }}
                >
                  <Icon size={18} style={{ color: "var(--mkt-primary)" }} aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(color:--mkt-text)">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── What we're retiring ── */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-ink)/[0.03] p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">
                What we’re retiring
              </span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Everything else
              </h2>
              <p className="mt-4 leading-relaxed text-(color:--mkt-text)">
                Trying to be a complete application platform pulled us in too
                many directions. Removing these features lets us make the
                engine faster, simpler to run, and easier to trust. Your own
                applications are a better home for the user experience.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {RETIRING.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 rounded-lg border border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-paper)/60 px-4 py-3 text-sm text-(color:--mkt-text)"
                >
                  <MinusCircle
                    className="h-4 w-4 shrink-0 text-(color:--mkt-subtle)"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Headless + open source ── */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">
              Where we’re going
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              An enterprise headless workflow engine.
              <br />
              <span style={{ color: "var(--mkt-primary)" }}>Open to everyone.</span>
            </h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {HEADLESS_POINTS.map(({ icon: Icon, title, body, href, cta }: { icon: typeof Braces; title: string; body: string; href?: string; cta?: string }) => (
              <div
                key={title}
                className="rounded-xl border border-(color:--mkt-primary)/20 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.06] p-6"
              >
                <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(color:--mkt-text)">
                  {body}
                </p>
                {href && (
                  <Link href={href} className="mt-3 inline-block text-sm font-semibold text-(color:--mkt-bronze) hover:underline">
                    {cta} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Existing users ── */}
        <section className="mx-auto max-w-3xl px-6 pb-24 pt-8">
          <div className="relative rounded-2xl border border-(color:--mkt-ink)/10 bg-(color:--mkt-paper)/60 p-8 shadow-xl shadow-black/10 sm:p-10">
            <div
              className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-(color:--mkt-primary)/60 to-transparent"
              aria-hidden="true"
            />
            <h2 className="text-2xl font-bold tracking-tight">
              Already using UserTasks?
            </h2>
            <ul className="mt-6 space-y-3">
              {[
                "You can still sign in to your workspace.",
                "Workflows, integrations, tasks, decision tables, agents, and reports carry forward.",
                "If you depend on a feature we’re retiring, please get in touch so we can talk it through.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-3">
                  <CheckCircle2
                    className="mt-0.5 h-5 w-5 shrink-0 text-(color:--mkt-bronze)"
                    aria-hidden="true"
                  />
                  <span className="text-sm leading-relaxed text-(color:--mkt-text)">
                    {line}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 text-sm font-semibold text-(color:--mkt-paper) transition hover:bg-(color:--mkt-primary-hover)"
              >
                Sign in
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 text-sm font-medium text-(color:--mkt-ink-soft) transition hover:border-(color:--mkt-ink)/30"
              >
                Contact the team
              </Link>
            </div>
            <p className="mt-8 text-sm leading-relaxed text-(color:--mkt-muted)">
              Thank you again for your time, your patience, and your feedback.
              We’re excited to build the next chapter in the open, with you.
            </p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
