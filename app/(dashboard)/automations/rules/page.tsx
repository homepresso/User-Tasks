"use client"

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { McpBanner } from '@/components/shared/mcp-banner'
import { CreateDecisionTableDialog } from '@/components/business-rules/create-decision-table-dialog'
import { ImportConfigButton } from '@/components/shared/config-transfer'
import { usePermissions } from '@/lib/permissions-context'
import { DecisionTableList } from '@/components/business-rules/decision-table-list'

export default function BusinessRulesPage() {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const { data: tables, isLoading } = useQuery({
    queryKey: ['decision-tables'],
    queryFn: async () => (await serverRead('automations.decisionTables')).data ?? [],
  })

  if (isLoading && !tables) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Business Rules</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Build decision tables with customizable inputs, outputs, and ordered rule logic.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Accepts config exports and the rule editor's own decision-table files. */}
          {can('workflows.edit') && <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ['decision-tables'] })} />}
          <CreateDecisionTableDialog />
        </div>
      </div>

      <McpBanner />

      <DecisionTableList tables={tables ?? []} />
    </div>
  )
}
