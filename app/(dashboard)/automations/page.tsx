"use client"

import { Suspense } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { serverRead } from "@/lib/server-read"
import { CreateWorkflowDialog } from "@/components/automations/create-workflow-dialog"
import { WorkflowList } from "@/components/automations/workflow-list"
import { ImportConfigButton } from "@/components/shared/config-transfer"
import { PageHeader } from "@/components/ui/page-header"
import { ListSkeleton, PageSkeleton } from "@/components/ui/page-skeleton"
import { usePermissions } from "@/lib/permissions-context"

export default function AutomationsPage() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()

  const { data: tagDefs, isLoading: isTagsLoading } = useQuery({
    queryKey: ["tag-definitions"],
    queryFn: async () => (await serverRead("automations.tagDefinitions")).data ?? [],
    enabled: can('workflows.view'),
  })

  if (!can('workflows.view')) {
    return <p className="text-sm text-fg-muted">Not authorized.</p>
  }

  if (isTagsLoading && !tagDefs) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Automate task workflows with triggers, conditions, and actions"
        actions={(
          <>
            {can('workflows.create') && <ImportConfigButton variant="outline" onImported={() => void queryClient.invalidateQueries({ queryKey: ["workflows"] })} />}
            <Suspense fallback={null}><CreateWorkflowDialog /></Suspense>
          </>
        )}
      />

      {/* The list's page, filters and size live in the URL (useSearchParams). */}
      <Suspense fallback={<ListSkeleton />}>
        <WorkflowList initialTagDefs={tagDefs ?? []} />
      </Suspense>
    </div>
  )
}
