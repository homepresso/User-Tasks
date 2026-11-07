"use client"

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
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
      <PageHeader
        className="mb-2"
        title="Business rules"
        description="Build decision tables with customizable inputs, outputs, and ordered rule logic."
        actions={
          <>
            {/* Accepts config exports and the rule editor's own decision-table files. */}
            {can('workflows.edit') && <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ['decision-tables'] })} />}
            <CreateDecisionTableDialog />
          </>
        }
      />

      <McpBanner />

      <DecisionTableList tables={tables ?? []} />
    </div>
  )
}
