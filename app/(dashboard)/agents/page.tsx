"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { AgentList } from '@/components/agents/agent-list'
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
    return <p className="text-sm text-fg-muted">Not authorized.</p>
  }

  if (isLoading && !agents) {
    return <PageSkeleton variant="list" />
  }

  // AgentList renders the page header (title, tabs, "New agent"): it owns the create dialog.
  return <AgentList agents={agents ?? []} />
}
