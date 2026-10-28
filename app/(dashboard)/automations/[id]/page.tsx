"use client"

import { use, useState } from 'react'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { WorkflowBuilder } from '@/components/automations/workflow-builder'
import { DesktopOnly } from '@/components/layout/desktop-only'
import Link from 'next/link'
import { ArrowLeft, GitBranch } from 'lucide-react'
import dynamic from 'next/dynamic'
import { usePermissions } from '@/lib/permissions-context'
import { RunWorkflowButton, RunWorkflowDialog } from '@/components/automations/run-workflow-dialog'
import { WorkflowFormLinkButton } from '@/components/automations/workflow-form-links'
import { ExportAssetButton } from '@/components/shared/config-transfer'

const LiveInstancesPanel = dynamic(() => import('@/components/automations/live-instances').then((m) => m.LiveInstancesPanel))

export default function WorkflowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [showInstances, setShowInstances] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const { can } = usePermissions()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['workflow', id],
    queryFn: async () => (await serverRead('automations.builder', { id })).data,
  })

  if (isLoading) return <WorkflowBuilderSkeleton />
  if (!data?.workflow) {
    return (
      <div className="p-6">
        <Link href="/automations" className="text-sm hover:underline" style={{ color: 'var(--theme-primary-text)' }}>← Back to Automations</Link>
        <p className="mt-4 text-sm" style={{ color: 'var(--theme-muted-text)' }}>Workflow not found.</p>
      </div>
    )
  }

  const { workflow, runs, customActivities, publishedVersionNumber, liveInstances, liveOnOlder } = data

  return (
    <DesktopOnly>
    <div className="h-[calc(100vh-7rem)]">
      <div className="flex items-center gap-3 mb-3">
        <Link href="/automations" className="rounded-md p-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-semibold">{workflow.name}</h1>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
          style={{
            backgroundColor: workflow.is_active ? 'color-mix(in srgb, var(--theme-success) 12%, transparent)' : 'var(--theme-surface)',
            color: workflow.is_active ? 'var(--theme-success)' : 'var(--theme-muted-text)',
          }}>
          {workflow.is_active ? (publishedVersionNumber ? `Published v${publishedVersionNumber}` : 'Active') : 'Draft'}
        </span>
        {liveInstances > 0 && (
          <button
            type="button"
            onClick={() => setShowInstances(true)}
            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: liveOnOlder > 0 ? 'var(--status-warning-bg)' : 'var(--theme-surface)',
              color: liveOnOlder > 0 ? 'var(--theme-warning)' : 'var(--theme-muted-text)',
            }}
            title="Live (waiting or paused) instances — view or migrate them"
          >
            <GitBranch size={11} />
            {liveOnOlder > 0
              ? `${liveOnOlder} live instance${liveOnOlder === 1 ? '' : 's'} on older versions`
              : `${liveInstances} live instance${liveInstances === 1 ? '' : 's'}`}
          </button>
        )}
        <WorkflowFormLinkButton workflowId={workflow.id} className="ml-auto" />
        <RunWorkflowButton
          workflow={workflow}
          canRun={can('workflows.activate')}
          onRun={() => setShowRun(true)}
        />
        <Link
          href={`/automations/${id}/runs`}
          className={`text-xs px-2.5 py-1 rounded-md border transition-colors hover:bg-[var(--theme-row-highlight)]`}
          style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
        >
          View Runs →
        </Link>
        <ExportAssetButton ids={[workflow.id]} name={workflow.name} className="!h-7" />
      </div>
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
      />
      <RunWorkflowDialog workflow={workflow} open={showRun} onOpenChange={(open) => { setShowRun(open); if (!open) void refetch() }} />
      {showInstances && <LiveInstancesPanel workflowId={workflow.id} onClose={() => { setShowInstances(false); void refetch() }} />}
    </div>
    </DesktopOnly>
  )
}

/**
 * Skeleton for the workflow builder. Mirrors the real layout: header with
 * title placeholder + status pill + action button, then a three-column
 * canvas with the palette on the left, a big canvas area in the middle
 * with a few placeholder nodes, and a properties panel on the right.
 * Uses the shimmer animation from app/globals.css.
 */
function WorkflowBuilderSkeleton() {
  const shimmer = 'shimmer 1.5s ease-in-out infinite'
  const bar = (w: string, h = 14, delay = 0) => (
    <div className="rounded" style={{
      width: w,
      height: h,
      backgroundColor: 'var(--theme-surface-border)',
      animation: shimmer,
      animationDelay: `${delay}s`,
    }} />
  )
  return (
    <div className="h-[calc(100vh-7rem)] page-transition">
      {/* Header row */}
      <div className="flex items-center gap-3 mb-3">
        <div className="rounded-md p-1" style={{ color: 'var(--theme-muted-text)' }}>
          <ArrowLeft size={20} />
        </div>
        {bar('200px', 20)}
        {bar('80px', 18, 0.05)}
        <div className="ml-auto">{bar('100px', 28, 0.1)}</div>
      </div>

      {/* Three-column layout: palette | canvas | properties */}
      <div className="grid h-[calc(100%-3rem)] gap-3" style={{ gridTemplateColumns: '220px 1fr 280px' }}>
        {/* Palette (left) */}
        <div className="rounded-xl border p-3 space-y-2 overflow-hidden"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          {bar('60%', 10)}
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className="flex items-center gap-2 p-2 rounded-lg"
              style={{ backgroundColor: 'var(--theme-surface)' }}>
              <div className="w-6 h-6 rounded" style={{ backgroundColor: 'var(--theme-surface-border)', animation: shimmer, animationDelay: `${i * 0.05}s` }} />
              {bar(`${60 + (i * 7) % 30}%`, 10, i * 0.05)}
            </div>
          ))}
        </div>

        {/* Canvas (middle) */}
        <div className="rounded-xl border relative overflow-hidden"
          style={{
            borderColor: 'var(--theme-surface-border)',
            backgroundColor: 'var(--theme-surface)',
            backgroundImage: 'radial-gradient(circle, var(--theme-surface-border) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}>
          {/* Placeholder nodes */}
          <div className="absolute" style={{ top: 60, left: 80 }}>
            <SkeletonNode delay={0} />
          </div>
          <div className="absolute" style={{ top: 180, left: 80 }}>
            <SkeletonNode delay={0.1} />
          </div>
          <div className="absolute" style={{ top: 300, left: 200 }}>
            <SkeletonNode delay={0.2} />
          </div>
          <div className="absolute" style={{ top: 180, left: 380 }}>
            <SkeletonNode delay={0.15} />
          </div>
          {/* Connection lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.3 }}>
            <line x1="180" y1="110" x2="180" y2="180" stroke="var(--theme-surface-border)" strokeWidth="2" />
            <line x1="180" y1="230" x2="250" y2="300" stroke="var(--theme-surface-border)" strokeWidth="2" />
            <line x1="280" y1="205" x2="380" y2="205" stroke="var(--theme-surface-border)" strokeWidth="2" />
          </svg>
          {/* Bottom-center loading hint */}
          <div className="absolute left-1/2 bottom-6 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', border: '1px solid', color: 'var(--theme-muted-text)' }}>
            <div className="w-3 h-3 rounded-full border-2"
              style={{ borderColor: 'var(--theme-surface-border)', borderTopColor: 'var(--theme-primary)', animation: 'spin 0.8s linear infinite' }} />
            Loading workflow…
          </div>
        </div>

        {/* Properties panel (right) */}
        <div className="rounded-xl border p-3 space-y-3 overflow-hidden"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          {bar('50%', 14)}
          {bar('80%', 10, 0.05)}
          <div className="h-px" style={{ backgroundColor: 'var(--theme-surface-border)' }} />
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="space-y-1.5">
              {bar(`${30 + i * 5}%`, 9, i * 0.06)}
              {bar('100%', 28, i * 0.06 + 0.02)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SkeletonNode({ delay }: { delay: number }) {
  return (
    <div className="w-[200px] rounded-xl border p-3 space-y-2"
      style={{
        borderColor: 'var(--theme-surface-border)',
        backgroundColor: 'var(--theme-card-bg)',
        boxShadow: 'var(--shadow-sm)',
        animation: 'shell-fade-in 0.3s ease-out both',
        animationDelay: `${delay}s`,
      }}>
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded" style={{ backgroundColor: 'var(--theme-primary-light)' }} />
        <div className="flex-1 h-3 rounded" style={{ backgroundColor: 'var(--theme-surface-border)' }} />
      </div>
      <div className="h-2 rounded" style={{ backgroundColor: 'var(--theme-surface)', width: '70%' }} />
    </div>
  )
}
