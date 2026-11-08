import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BookOpen, Cloud, Server, Terminal } from 'lucide-react'
import { DOC_SECTIONS, docHref } from '@/lib/docs/registry'
import { Screenshot } from '@/components/docs/doc-blocks'

export const metadata: Metadata = {
  title: 'UserTasks documentation — headless workflow engine',
  description: 'Guides and reference for the UserTasks workflow engine: designer, nodes, expressions, tasks, integrations, decision tables, agents, governance, REST API, MCP, CLI, log export and self-hosting.',
  alternates: { canonical: '/docs' },
  openGraph: {
    title: 'UserTasks documentation',
    description: 'Build workflows, human tasks, integrations and rules, and drive them from the API, MCP or CLI. Ship logs to Splunk, Datadog or OpenTelemetry.',
    url: '/docs',
    type: 'website',
  },
}

/** Deep links into long guides that are easy to miss from the section list. */
const POPULAR = [
  { title: 'Step-by-step tutorials', href: '/docs/tutorials' },
  { title: 'Build a form with the wizard', href: '/docs/tasks/form-wizard' },
  { title: 'Set up the Agent (AI assistant)', href: '/docs/ai-assistants' },
  { title: 'Share and embed a form', href: '/docs/tasks/forms#sharing-and-embedding-forms' },
  { title: 'Form sign-in page', href: '/docs/tasks/forms#form-sign-in-page' },
  { title: 'Workspace address and friendly links', href: '/docs/governance/workspace-address' },
  { title: 'Form rules and read-only parts', href: '/docs/tasks/forms#rules' },
  { title: 'Parameters and test inputs', href: '/docs/tasks/forms#parameters-and-variables' },
  { title: 'When to load (faster forms)', href: '/docs/tasks/forms#when-to-load-faster-forms' },
  { title: 'Queued tasks and queue rules', href: '/docs/tasks#task-queue-rules' },
  { title: 'Task attachments', href: '/docs/tasks/attachments' },
  { title: 'Task completed screen', href: '/docs/tasks#task-completed-screen' },
]

const STARTS = [
  { icon: Cloud, title: 'Cloud quickstart', body: 'Sign in, build and publish a first workflow, run it.', href: '/docs/quickstart/cloud' },
  { icon: Server, title: 'Self-host quickstart', body: 'Supabase, environment, bootstrap, run — locally or with Docker.', href: '/docs/quickstart/self-host' },
  { icon: Terminal, title: 'CLI', body: 'Log in, edit workflows as files, tail logs, promote config.', href: '/docs/cli' },
  { icon: BookOpen, title: 'Concepts', body: 'Workflows, runs, tasks and the assets around them.', href: '/docs/concepts' },
]

export default function DocsHome() {
  return (
    <div className="max-w-5xl pb-24 pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">Documentation</p>
      <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">Build on the UserTasks workflow engine</h1>
      <p className="mt-4 max-w-3xl mkt-body text-(color:--mkt-muted)">
        Design workflows visually or as JSON, put people in the loop with tasks, connect any API, and drive all of it from the REST API, the MCP server or the <code className="rounded bg-(color:--mkt-ink)/[0.06] px-1.5 font-mono text-base">usertasks</code> CLI. Reference pages are generated from the code, so they match the version you run.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STARTS.map(({ icon: Icon, title, body, href }) => (
          <Link key={href} href={href} className="group rounded-xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white)/70 p-4 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-sm">
            <Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />
            <span className="mt-3 flex items-center gap-1 font-semibold text-(color:--mkt-ink)">{title}<ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
            <span className="mt-1 block text-sm leading-6 text-(color:--mkt-muted)">{body}</span>
          </Link>
        ))}
      </div>

      <section aria-labelledby="home-popular" className="mt-8">
        <h2 id="home-popular" className="text-sm font-semibold text-(color:--mkt-ink)">Popular guides</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {POPULAR.map(({ title, href }) => (
            <li key={href}>
              <Link href={href} className="inline-flex items-center rounded-full border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white)/70 px-3 py-1.5 text-sm font-medium text-(color:--mkt-ink-soft) transition hover:border-(color:--mkt-bronze)/40 hover:text-(color:--mkt-bronze)">{title}</Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="max-w-4xl">
        <Screenshot name="designer" alt="The UserTasks workflow designer with an invoice approval workflow" caption="The designer: an invoice approval with an API call, a decision table, a user task and an email." priority />
      </div>

      <div className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {DOC_SECTIONS.map((section) => (
          <section key={section.title} aria-labelledby={`home-${section.title}`}>
            <h2 id={`home-${section.title}`} className="font-display text-lg font-semibold">{section.title}</h2>
            <ul className="mt-3 space-y-2.5">
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link href={docHref(page.slug)} className="font-medium text-(color:--mkt-ink) hover:text-(color:--mkt-bronze)">{page.title}</Link>
                  <p className="text-sm leading-6 text-(color:--mkt-muted)">{page.description}</p>
                </li>
              ))}
              {(section.links ?? []).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="font-medium text-(color:--mkt-ink) hover:text-(color:--mkt-bronze)">{link.title}</Link>
                  <p className="text-sm leading-6 text-(color:--mkt-muted)">Try every endpoint in the browser and copy a cURL request.</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
