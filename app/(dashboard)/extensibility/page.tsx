"use client"

import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { Puzzle } from 'lucide-react'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { McpBanner } from '@/components/shared/mcp-banner'
import { usePermissions } from '@/lib/permissions-context'
import { WorkflowActivitiesView } from '@/components/extensibility/workflow-activities-view'
import { hasExtensibilityFeatureAccess } from '@/lib/extensibility-access'

export default function ExtensibilityPage() {
  const { permissions } = usePermissions()
  const canAccessExtensibility = hasExtensibilityFeatureAccess(permissions)
  const { data: workflowActivities, isLoading: workflowActivitiesLoading } = useQuery({
    queryKey: ['custom-workflow-activities'],
    queryFn: () => serverQuery('settings.workflowActivities'),
    enabled: canAccessExtensibility,
  })

  if (!canAccessExtensibility) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  if (workflowActivitiesLoading && !workflowActivities) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
          <Puzzle size={18} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Extensibility</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Govern custom workflow activities with the same governance and MCP surface as the rest of the platform.
          </p>
        </div>
      </div>

      <McpBanner />

      <WorkflowActivitiesView items={workflowActivities ?? []} />
    </div>
  )
}
