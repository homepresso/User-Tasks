'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { WorkspaceCosts, type WorkspaceCostData } from '@/components/agents/agent-costs'
import { AGENTS_DESCRIPTION, AgentsTabs } from '@/components/agents/agent-list'
import { applyAgentPriceUpdates, fetchAgentPriceUpdates, saveAgentCostSettings } from '@/app/actions/agents'

/** Agents → Costs & budgets (agents.view; editing needs settings.edit). */
export default function AgentCostsPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['agent-costs'], queryFn: () => serverQuery('agents.costs') })
  if (isLoading && !data) return <PageSkeleton variant="detail" />
  return (
    <div>
      <PageHeader title="Agents" description={AGENTS_DESCRIPTION} tabs={<AgentsTabs value="costs" />} />
      {data && (
        // Remounts with the saved prices after "Fetch latest pricing" saves some.
        <WorkspaceCosts key={JSON.stringify((data as unknown as WorkspaceCostData).prices.workspace)} data={data as unknown as WorkspaceCostData}
          priceUpdates={{ fetch: fetchAgentPriceUpdates, apply: applyAgentPriceUpdates }}
          onPricesChanged={() => queryClient.invalidateQueries({ queryKey: ['agent-costs'] })}
          onSave={async (input) => {
          const result = await saveAgentCostSettings(input)
          if (!result.ok) return result.error
          await queryClient.invalidateQueries({ queryKey: ['agent-costs'] })
          return null
        }} />
      )}
    </div>
  )
}
