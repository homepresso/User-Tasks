"use client"

import { use, useState } from 'react'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { WorkflowBuilder } from '@/components/automations/workflow-builder'
import { DesktopOnly } from '@/components/layout/desktop-only'
import Link from 'next/link'
import { ArrowLeft, Download, GitBranch, Link2, ListChecks, Play } from 'lucide-react'
import dynamic from 'next/dynamic'
import { usePermissions } from '@/lib/permissions-context'
import { RunWorkflowDialog, runDisabledReason } from '@/components/automations/run-workflow-dialog'
import { FormLinksDialog, hasFormEntries, useWorkflowFormEntries } from '@/components/automations/workflow-form-links'
import { ExportAssetDialog } from '@/components/shared/config-transfer'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { plural } from '@/lib/format/plural'

const LiveInstancesPanel = dynamic(() => import('@/components/automations/live-instances').then((m) => m.LiveInstancesPanel))

export default function WorkflowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [showInstances, setShowInstances] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showFormLink, setShowFormLink] = useState(false)
  const { can } = usePermissions()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['workflow', id],
    queryFn: async () => (await serverRead('automations.builder', { id })).data,
  })
  const { data: formEntries } = useWorkflowFormEntries(id, Boolean(data?.workflow))

  if (isLoading) return <WorkflowBuilderSkeleton />
  if (!data?.workflow) {
    return (
      <EmptyState
        variant="no-results"
        title="Workflow not found"
        description="It may have been deleted, or you don't have access to it."
        action={{ label: 'Back to workflows', href: '/automations' }}
      />
    )
  }

  const { workflow, runs, customActivities, publishedVersionNumber, liveInstances, liveOnOlder } = data
  const runReason = runDisabledReason(workflow)
  const canRun = can('workflows.activate')

  const menuItems = (
    <>
      {canRun && (
        <DropdownMenuItem icon={<Play />} disabled={Boolean(runReason)} onSelect={() => setShowRun(true)}>
          {runReason ? `Run (${runReason})` : 'Run now…'}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <Link href={`/automations/${id}/runs`}><ListChecks className="size-4 text-fg-muted" aria-hidden="true" /><span className="flex-1">View runs</span></Link>
      </DropdownMenuItem>
      {liveInstances > 0 && (
        <DropdownMenuItem icon={<GitBranch />} onSelect={() => setShowInstances(true)}>
          {`${plural(liveInstances, 'live instance')}…`}
        </DropdownMenuItem>
      )}
      {hasFormEntries(formEntries) && (
        <DropdownMenuItem icon={<Link2 />} onSelect={() => setShowFormLink(true)}>Form link…</DropdownMenuItem>
      )}
      <DropdownMenuItem icon={<Download />} onSelect={() => setShowExport(true)}>Export…</DropdownMenuItem>
    </>
  )

  const notice = liveOnOlder > 0 ? (
    <div className="mb-2" data-live-instances-notice="">
      <InlineNotice
        tone="warning"
        message={`${plural(liveOnOlder, 'live instance')} on older versions`}
        actions={<Button variant="secondary" size="sm" onClick={() => setShowInstances(true)}>Migrate…</Button>}
      />
    </div>
  ) : null

  return (
    <DesktopOnly>
    <div className="h-[calc(100vh-7rem)]">
      <WorkflowBuilder
        workflowId={workflow.id}
        tenantId={workflow.tenant_id}
        initialNodes={(workflow.nodes as any) ?? []}
        initialEdges={(workflow.edges as any) ?? []}
        triggerType={workflow.trigger_type}
        isActive={workflow.is_active ?? false}
        runs={(runs as any) ?? []}
        initialUserVariables={workflow.user_variables as any ?? []}
        initialSwimlanes={workflow.swimlanes as any ?? []}
        customActivities={customActivities ?? []}
        publishedVersionNumber={publishedVersionNumber}
        hasUnpublishedChanges={workflow.has_unpublished_changes ?? true}
        workflowName={workflow.name}
        backHref="/automations"
        menuItems={menuItems}
        notice={notice}
      />
      <RunWorkflowDialog workflow={workflow} open={showRun} onOpenChange={(open) => { setShowRun(open); if (!open) void refetch() }} />
      <ExportAssetDialog ids={[workflow.id]} name={workflow.name} open={showExport} onOpenChange={setShowExport} />
      <FormLinksDialog workflow={showFormLink ? workflow : null} onOpenChange={(open) => { if (!open) setShowFormLink(false) }} />
      {showInstances && <LiveInstancesPanel workflowId={workflow.id} onClose={() => { setShowInstances(false); void refetch() }} />}
    </div>
    </DesktopOnly>
  )
}

/**
 * Skeleton for the workflow builder: mirrors the real layout — the 48px
 * toolbar row, then palette | canvas (with a few placeholder steps) |
 * inspector.
 */
function WorkflowBuilderSkeleton() {
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col" aria-busy="true" aria-label="Loading workflow">
      <div className="mb-2 flex h-12 shrink-0 items-center gap-3 rounded-lg border border-border bg-panel px-3">
        <ArrowLeft className="size-4 text-fg-muted" aria-hidden="true" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-24" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="w-12 shrink-0 rounded-lg border border-border bg-panel min-[1600px]:w-60" />
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-bg"
          style={{ backgroundImage: 'radial-gradient(circle, color-mix(in srgb, var(--ds-border) 80%, transparent) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
          {[{ top: 60, left: 120 }, { top: 180, left: 120 }, { top: 300, left: 240 }, { top: 180, left: 420 }].map((p, i) => (
            <div key={i} className="absolute w-56 space-y-2 rounded-lg border border-border bg-panel p-3" style={p}>
              <div className="flex items-center gap-2">
                <Skeleton className="size-5" />
                <Skeleton className="h-3 flex-1" />
              </div>
              <Skeleton className="h-2 w-2/3" />
            </div>
          ))}
        </div>
        <div className="w-[360px] shrink-0 space-y-4 rounded-lg border border-border bg-panel p-3">
          <div className="flex gap-4 border-b border-border-subtle pb-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-16" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-1/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
