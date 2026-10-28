"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { AgentList } from '@/components/agents/agent-list'
import { McpBanner } from '@/components/shared/mcp-banner'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { usePermissions } from '@/lib/permissions-context'

export default function AgentsPage() {
  const { can } = usePermissions()

  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => serverQuery('agents.list'),
    enabled: can('agents.view'),
  })

  if (!can('agents.view')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  if (isLoading && !agents) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">AI Agents</h1>
      </div>

      <McpBanner />

      <AgentList agents={agents ?? []} />
    </div>
  )
}
