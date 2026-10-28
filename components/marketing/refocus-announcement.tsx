import type { CSSProperties } from "react";
import Link from "next/link";
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
import { Wordmark } from "@/components/brand/logo"

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
      className="ut-landing min-h-screen text-[#1B1916]"
      style={{
        background:
          "linear-gradient(160deg, #FAF8F3 0%, #F1EDE3 45%, #F5F2EA 100%)",
        // globals.css themes the whole app via unlayered --theme-* rules (h1-h4,
        // labels, selects, [class*="bg-white"] repaints…) whose :root defaults are
        // LIGHT-theme values. Like app/(auth)/layout.tsx, reset every variable here
        // — but to values matching this page's design.
        "--theme-primary": "#17150F",
        "--theme-primary-hover": "#2E2A24",
        "--theme-primary-light": "rgba(23,21,15,0.14)",
        "--theme-card-bg": "#FFFFFF",
        "--theme-card-text": "#1B1916",
        "--theme-surface": "#F5F2EA",
        "--theme-surface-border": "#E6E1D5",
        "--theme-muted-text": "#6E6759",
        "--theme-sidebar-bg": "#FAF8F3",
        "--theme-sidebar-text": "#1B1916",
        "--theme-topbar": "#FAF8F3",
        "--theme-topbar-text": "#1B1916",
        "--theme-accent": "#17150F",
        "--theme-danger": "#D07A6A",
        "--theme-success": "#7FA98A",
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
      <header className="relative z-10">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-5 sm:px-6">
          <Link href="/" aria-label="UserTasks home">
            <Wordmark size={34} />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/docs"
              className="hidden rounded-lg px-4 py-2 text-sm font-medium text-[#4A463E] transition hover:text-[#1B1916] sm:inline"
            >
              Documentation
            </Link>
            <Link
              href="/contact"
              className="hidden rounded-lg px-4 py-2 text-sm font-medium text-[#4A463E] transition hover:text-[#1B1916] md:inline"
            >
              Contact
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-[#17150F] px-4 py-2 text-sm font-semibold text-[#FAF8F3] transition hover:bg-[#2E2A24]"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        {/* ── Announcement hero ── */}
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-24">
          <div style={{ animation: "fadeInDown 0.6s ease-out both" }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#17150F]/30 bg-[#17150F]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#8A6D45]">
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
            className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#4A463E]"
            style={{ animation: "fadeInUp 0.8s ease-out 0.3s both" }}
          >
            Every workspace you created, every workflow you built, and every
            piece of feedback you sent helped shape what comes next. We have
            decided to strip UserTasks back to what it does best:{" "}
            <span className="font-semibold text-[#1B1916]">
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
              className="group inline-flex items-center gap-2 rounded-lg bg-[#17150F] px-8 py-4 text-base font-semibold text-[#FAF8F3] shadow-lg shadow-[#17150F]/25 transition hover:bg-[#2E2A24] hover:shadow-[#17150F]/30"
            >
              See what’s changing
              <ArrowRight
                className="h-4 w-4 transition group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg border border-[#1B1916]/15 px-8 py-4 text-base font-medium text-[#33302A] transition hover:border-[#1B1916]/30 hover:bg-[rgba(67,62,60,0.05)]"
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
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">
              What we’re keeping
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              A focused core, built to be relied on
            </h2>
            <p className="mt-4 leading-relaxed text-[#4A463E]">
              These are the parts that carry real processes. They get all of
              our attention from here on.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {KEEPING.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FAF8F3]/60 p-6"
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: "rgba(23,21,15,0.10)" }}
                >
                  <Icon size={18} style={{ color: "#17150F" }} aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#4A463E]">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── What we're retiring ── */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 rounded-2xl border border-[#1B1916]/[0.08] bg-[#1B1916]/[0.03] p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">
                What we’re retiring
              </span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Everything else
              </h2>
              <p className="mt-4 leading-relaxed text-[#4A463E]">
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
                  className="flex items-center gap-3 rounded-lg border border-[#1B1916]/[0.06] bg-[#FAF8F3]/60 px-4 py-3 text-sm text-[#4A463E]"
                >
                  <MinusCircle
                    className="h-4 w-4 shrink-0 text-[#857D6D]"
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
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">
              Where we’re going
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              An enterprise headless workflow engine.
              <br />
              <span style={{ color: "#17150F" }}>Open to everyone.</span>
            </h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {HEADLESS_POINTS.map(({ icon: Icon, title, body, href, cta }: { icon: typeof Braces; title: string; body: string; href?: string; cta?: string }) => (
              <div
                key={title}
                className="rounded-xl border border-[#17150F]/20 bg-gradient-to-br from-[#17150F]/[0.06] via-transparent to-[#B08A54]/[0.06] p-6"
              >
                <Icon size={20} className="text-[#8A6D45]" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#4A463E]">
                  {body}
                </p>
                {href && (
                  <Link href={href} className="mt-3 inline-block text-sm font-semibold text-[#8A6D45] hover:underline">
                    {cta} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Existing users ── */}
        <section className="mx-auto max-w-3xl px-6 pb-24 pt-8">
          <div className="relative rounded-2xl border border-[#1B1916]/10 bg-[#FAF8F3]/60 p-8 shadow-xl shadow-black/10 sm:p-10">
            <div
              className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-[#17150F]/60 to-transparent"
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
                    className="mt-0.5 h-5 w-5 shrink-0 text-[#8A6D45]"
                    aria-hidden="true"
                  />
                  <span className="text-sm leading-relaxed text-[#4A463E]">
                    {line}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 text-sm font-semibold text-[#FAF8F3] transition hover:bg-[#2E2A24]"
              >
                Sign in
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 text-sm font-medium text-[#33302A] transition hover:border-[#1B1916]/30"
              >
                Contact the team
              </Link>
            </div>
            <p className="mt-8 text-sm leading-relaxed text-[#6E6759]">
              Thank you again for your time, your patience, and your feedback.
              We’re excited to build the next chapter in the open, with you.
            </p>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-[#1B1916]/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <Wordmark size={26} />
          <p className="text-xs text-[#857D6D]">
            Open-source headless workflow engine. © {new Date().getFullYear()}{" "}
            UserTasks.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/login" className="text-xs text-[#6E6759] transition hover:text-[#1B1916]">Sign in</Link>
            <Link href="/contact" className="text-xs text-[#6E6759] transition hover:text-[#1B1916]">Contact</Link>
            <Link href="/docs" className="text-xs text-[#6E6759] transition hover:text-[#1B1916]">Documentation</Link>
            <Link href="/deploy-anywhere" className="text-xs text-[#6E6759] transition hover:text-[#1B1916]">Deploy anywhere</Link>
            <Link href="/docs/api-explorer" className="text-xs text-[#6E6759] transition hover:text-[#1B1916]">API Explorer</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
