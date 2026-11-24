"use client"

import { Suspense } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CreateWorkflowDialog } from "@/components/automations/create-workflow-dialog"
import { WorkflowList } from "@/components/automations/workflow-list"
import { ImportConfigButton } from "@/components/shared/config-transfer"
import { ExtensionImportButton } from "@/components/extensions/importers"
import { PageHeader } from "@/components/ui/page-header"
import { ListSkeleton } from "@/components/ui/page-skeleton"
import { usePermissions } from "@/lib/permissions-context"

export default function AutomationsPage() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()

  if (!can('workflows.view')) {
    return <p className="text-sm text-fg-muted">Not authorized.</p>
  }

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Automate task workflows with triggers, conditions, and actions"
        actions={(
          <>
            {can('workflows.create') && <ImportConfigButton variant="outline" onImported={() => void queryClient.invalidateQueries({ queryKey: ["workflows"] })} />}
            {/* Importers contributed by extensions (e.g. SharePoint Designer 2010 workflows); nothing without any. */}
            {/* + the core Nintex importer; ?import=nintex opens it (SharePoint dashboard links). */}
            <Suspense fallback={null}><ExtensionImportButton produces="workflow" onImported={() => void queryClient.invalidateQueries({ queryKey: ["workflows"] })} /></Suspense>
            <Suspense fallback={null}><CreateWorkflowDialog /></Suspense>
          </>
        )}
      />

      {/* The list's page, filters and size live in the URL (useSearchParams). */}
      <Suspense fallback={<ListSkeleton />}>
        <WorkflowList />
      </Suspense>
    </div>
  )
}
