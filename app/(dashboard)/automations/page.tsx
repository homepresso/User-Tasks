"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { serverRead } from "@/lib/server-read"
import { CreateWorkflowDialog } from "@/components/automations/create-workflow-dialog"
import { WorkflowList } from "@/components/automations/workflow-list"
import { McpBanner } from "@/components/shared/mcp-banner"
import { ImportConfigButton } from "@/components/shared/config-transfer"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { usePermissions } from "@/lib/permissions-context"

export default function AutomationsPage() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const { data: workflows, isLoading: isWorkflowsLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: async () => (await serverRead("automations.list")).data ?? [],
    enabled: can('workflows.view'),
  })

  const { data: tagDefs, isLoading: isTagsLoading } = useQuery({
    queryKey: ["tag-definitions"],
    queryFn: async () => (await serverRead("automations.tagDefinitions")).data ?? [],
    enabled: can('workflows.view'),
  })

  if (!can('workflows.view')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  if (isWorkflowsLoading && isTagsLoading && !workflows && !tagDefs) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <p className="text-xs mt-1" style={{ color: "var(--theme-muted-text)" }}>
            Automate task workflows with triggers, conditions, and actions
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can('workflows.create') && <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ["workflows"] })} />}
          <CreateWorkflowDialog />
        </div>
      </div>

      <McpBanner />

      <WorkflowList
        workflows={workflows ?? []}
        initialTagDefs={tagDefs ?? []}
      />
    </div>
  )
}
