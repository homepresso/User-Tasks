"use client"

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabPanel } from '@/components/ui/tabs'
import { McpBanner } from '@/components/shared/mcp-banner'
import { usePermissions } from '@/lib/permissions-context'
import { WorkflowActivitiesView } from '@/components/extensibility/workflow-activities-view'
import { FormControlsView } from '@/components/extensibility/form-controls-view'
import { hasExtensibilityFeatureAccess } from '@/lib/extensibility-access'

export default function ExtensibilityPage() {
  const { permissions } = usePermissions()
  const canAccessExtensibility = hasExtensibilityFeatureAccess(permissions)
  const [tab, setTab] = useState<'activities' | 'form-controls'>('activities')
  useEffect(() => {
    // ?tab=form-controls (links from the form designer's palette).
    if (new URLSearchParams(window.location.search).get('tab') === 'form-controls') setTab('form-controls')
  }, [])
  const selectTab = (next: 'activities' | 'form-controls') => {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === 'activities') url.searchParams.delete('tab')
    else url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url)
  }
  const { data: workflowActivities, isLoading: workflowActivitiesLoading } = useQuery({
    queryKey: ['custom-workflow-activities'],
    queryFn: () => serverQuery('settings.workflowActivities'),
    enabled: canAccessExtensibility,
    // Package installs (and the API / CLI) add actions elsewhere: never trust the persisted copy alone.
    refetchOnMount: 'always',
  })

  if (!canAccessExtensibility) {
    return <p className="text-sm text-fg-muted">Not authorized.</p>
  }

  if (workflowActivitiesLoading && !workflowActivities) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-2"
        title="Extensibility"
        description="Custom workflow actions (sandboxed steps) and custom form controls, with the same governance, API and MCP surface as the rest of the platform."
      />

      <McpBanner />

      <Tabs
        aria-label="Extensibility"
        idBase="ext"
        value={tab}
        onValueChange={selectTab}
        items={[
          { value: 'activities', label: 'Workflow actions' },
          { value: 'form-controls', label: 'Form controls' },
        ]}
      />

      <TabPanel idBase="ext" value={tab}>
        {tab === 'activities' ? <WorkflowActivitiesView items={workflowActivities ?? []} /> : <FormControlsView />}
      </TabPanel>
    </div>
  )
}
