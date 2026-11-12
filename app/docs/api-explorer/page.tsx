import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { PublicApiExplorer } from '@/components/marketing/public-api-explorer'

export const metadata: Metadata = { title: 'API Explorer — UserTasks docs', description: 'Explore UserTasks REST API endpoints, authentication, parameters, payloads, and example cURL requests.', alternates: { canonical: '/docs/api-explorer' } }

export default function PublicApiExplorerPage() {
  return (
    <div className="pb-24 pt-8 sm:pt-10">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-ui text-(color:--mkt-muted)">
          <li><Link href="/docs" className="hover:text-(color:--mkt-ink)">Docs</Link></li>
          <li className="flex items-center gap-1"><ChevronRight size={13} aria-hidden="true" className="text-(color:--mkt-subtle)" /><Link href="/docs/api" className="hover:text-(color:--mkt-ink)">API and MCP</Link></li>
          <li className="flex items-center gap-1"><ChevronRight size={13} aria-hidden="true" className="text-(color:--mkt-subtle)" /><span aria-current="page" className="font-medium text-(color:--mkt-ink-soft)">API Explorer</span></li>
        </ol>
      </nav>
      <div className="mt-4 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">API and MCP</p>
        <h1 className="mt-2 font-display text-[2.1rem] font-semibold leading-[1.12] tracking-[-0.015em] sm:text-[2.6rem]">API Explorer</h1>
        <p className="mt-3 mkt-body text-(color:--mkt-muted)">Browse the REST API without signing in. Select an endpoint to inspect parameters and generate a safe example request.</p>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <a href="/api/v1/openapi.json" className="inline-flex items-center gap-1 text-(color:--mkt-bronze) hover:underline">OpenAPI document <ExternalLink size={12} /></a>
          <a href="/.well-known/oauth-authorization-server" className="inline-flex items-center gap-1 text-(color:--mkt-bronze) hover:underline">OAuth server metadata <ExternalLink size={12} /></a>
          <a href="/.well-known/oauth-protected-resource" className="inline-flex items-center gap-1 text-(color:--mkt-bronze) hover:underline">Protected-resource metadata <ExternalLink size={12} /></a>
        </div>
      </div>
      <div className="mt-8"><PublicApiExplorer /></div>
    </div>
  )
}
