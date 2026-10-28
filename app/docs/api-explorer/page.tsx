import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { PublicApiExplorer } from '@/components/marketing/public-api-explorer'

export const metadata: Metadata = { title: 'API Explorer — UserTasks docs', description: 'Explore UserTasks REST API endpoints, authentication, parameters, payloads, and example cURL requests.', alternates: { canonical: '/docs/api-explorer' } }

export default function PublicApiExplorerPage() {
  return (
    <div className="pb-24 pt-10">
      <Link href="/docs/api" className="inline-flex items-center gap-1 text-sm text-[#8A6D45] hover:underline"><ArrowLeft size={14} /> REST API guide</Link>
      <div className="mt-4 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A6D45]">API and MCP</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">API Explorer</h1>
        <p className="mt-3 text-lg leading-8 text-[#6E6759]">Browse the REST API without signing in. Select an endpoint to inspect parameters and generate a safe example request.</p>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <a href="/api/v1/openapi.json" className="inline-flex items-center gap-1 text-[#8A6D45] hover:underline">OpenAPI document <ExternalLink size={12} /></a>
          <a href="/.well-known/oauth-authorization-server" className="inline-flex items-center gap-1 text-[#8A6D45] hover:underline">OAuth server metadata <ExternalLink size={12} /></a>
          <a href="/.well-known/oauth-protected-resource" className="inline-flex items-center gap-1 text-[#8A6D45] hover:underline">Protected-resource metadata <ExternalLink size={12} /></a>
        </div>
      </div>
      <div className="mt-8"><PublicApiExplorer /></div>
    </div>
  )
}
