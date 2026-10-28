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

const STARTS = [
  { icon: Cloud, title: 'Cloud quickstart', body: 'Sign in, build and publish a first workflow, run it.', href: '/docs/quickstart/cloud' },
  { icon: Server, title: 'Self-host quickstart', body: 'Supabase, environment, bootstrap, run — locally or with Docker.', href: '/docs/quickstart/self-host' },
  { icon: Terminal, title: 'CLI', body: 'Log in, edit workflows as files, tail logs, promote config.', href: '/docs/cli' },
  { icon: BookOpen, title: 'Concepts', body: 'Workflows, runs, tasks and the assets around them.', href: '/docs/concepts' },
]

export default function DocsHome() {
  return (
    <div className="max-w-5xl pb-24 pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A6D45]">Documentation</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight sm:text-5xl">Build on the UserTasks workflow engine</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-[#6E6759]">
        Design workflows visually or as JSON, put people in the loop with tasks, connect any API, and drive all of it from the REST API, the MCP server or the <code className="rounded bg-[#1B1916]/[0.06] px-1.5 font-mono text-base">usertasks</code> CLI. Reference pages are generated from the code, so they match the version you run.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STARTS.map(({ icon: Icon, title, body, href }) => (
          <Link key={href} href={href} className="group rounded-xl border border-[#1B1916]/[0.09] bg-[#FFFFFF]/70 p-4 transition hover:border-[#8A6D45]/40 hover:shadow-sm">
            <Icon size={18} className="text-[#8A6D45]" aria-hidden="true" />
            <span className="mt-3 flex items-center gap-1 font-semibold text-[#1B1916]">{title}<ArrowRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
            <span className="mt-1 block text-sm leading-6 text-[#6E6759]">{body}</span>
          </Link>
        ))}
      </div>

      <div className="max-w-4xl">
        <Screenshot name="designer" alt="The UserTasks workflow designer with an invoice approval workflow" caption="The designer: an invoice approval with an API call, a decision table, a user task and an email." priority />
      </div>

      <div className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {DOC_SECTIONS.map((section) => (
          <section key={section.title} aria-labelledby={`home-${section.title}`}>
            <h2 id={`home-${section.title}`} className="font-[family-name:var(--font-display)] text-lg font-semibold">{section.title}</h2>
            <ul className="mt-3 space-y-2.5">
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link href={docHref(page.slug)} className="font-medium text-[#1B1916] hover:text-[#8A6D45]">{page.title}</Link>
                  <p className="text-sm leading-6 text-[#6E6759]">{page.description}</p>
                </li>
              ))}
              {(section.links ?? []).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="font-medium text-[#1B1916] hover:text-[#8A6D45]">{link.title}</Link>
                  <p className="text-sm leading-6 text-[#6E6759]">Try every endpoint in the browser and copy a cURL request.</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
