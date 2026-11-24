'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { WorkspaceCosts, type WorkspaceCostData } from '@/components/agents/agent-costs'
import { breakdownArgs, CostBreakdownView, type BreakdownData, type BreakdownState } from '@/components/agents/cost-breakdown'
import { AGENTS_DESCRIPTION, AgentsTabs } from '@/components/agents/agent-list'
import { applyAgentPriceUpdates, fetchAgentPriceUpdates, saveAgentCostSettings } from '@/app/actions/agents'

/** Agents → Costs & budgets (agents.view; editing needs settings.edit; costs per person need assistants.manage). */
export default function AgentCostsPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['agent-costs'], queryFn: () => serverQuery('agents.costs') })
  const [state, setState] = useState<BreakdownState>({ period: '30d', filters: {} })
  // Person rows are asked for once the first answer says this person may see them.
  const [canSeePeople, setCanSeePeople] = useState(false)
  const args = breakdownArgs(state, canSeePeople)
  const breakdown = useQuery({
    queryKey: ['agent-cost-breakdown', args],
    queryFn: async () => {
      const result = await serverQuery('agents.costBreakdown', args as never) as unknown as BreakdownData
      if (result.can_see_people && !canSeePeople) setCanSeePeople(true)
      return result
    },
    placeholderData: keepPreviousData,
  })
  if (isLoading && !data) return <PageSkeleton variant="detail" />
  return (
    <div>
      <PageHeader title="Agents" description={AGENTS_DESCRIPTION} tabs={<AgentsTabs value="costs" />} />
      {data && (
        // Remounts with the saved prices after "Fetch latest pricing" saves some.
        <WorkspaceCosts key={JSON.stringify((data as unknown as WorkspaceCostData).prices.workspace)} data={data as unknown as WorkspaceCostData}
          priceUpdates={{ fetch: fetchAgentPriceUpdates, apply: applyAgentPriceUpdates }}
          onPricesChanged={async () => {
            await queryClient.invalidateQueries({ queryKey: ['agent-costs'] })
            await queryClient.invalidateQueries({ queryKey: ['agent-cost-breakdown'] })
          }}
          renderBreakdown={({ canEditPrices, onAddPrice }) => (
            <CostBreakdownView data={breakdown.data} state={state} onChange={setState} loading={breakdown.isLoading}
              error={breakdown.error ? (breakdown.error as Error).message : null} canEditPrices={canEditPrices} onAddPrice={onAddPrice} />
          )}
          onSave={async (input) => {
          const result = await saveAgentCostSettings(input)
          if (!result.ok) return result.error
          await queryClient.invalidateQueries({ queryKey: ['agent-costs'] })
          await queryClient.invalidateQueries({ queryKey: ['agent-cost-breakdown'] })
          return null
        }} />
      )}
    </div>
  )
}
