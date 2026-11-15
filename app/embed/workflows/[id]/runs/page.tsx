import type { Metadata } from 'next'
import WorkflowRunsPage from '@/app/(dashboard)/automations/[id]/runs/page'
import { EmbeddedDesignerShell } from '@/components/embed/designer-shell'
import { embedDesignerGate, type Query } from '@/lib/embed/designer-route'

/** Embedded: a workflow's runs (/automations/<id>/runs without the app shell, lib/embed/designers.ts). */

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Workflow runs', robots: { index: false, follow: false } }

export default async function EmbeddedWorkflowRuns({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params
  const gate = await embedDesignerGate({ kind: 'runs', id, embedPath: `/embed/workflows/${id}/runs`, appPath: `/automations/${id}/runs`, query: await searchParams, allOf: ['workflows.view'] })
  if (gate.kind === 'node') return gate.node
  return (
    <EmbeddedDesignerShell {...gate.shell}>
      <div className="p-2"><WorkflowRunsPage params={Promise.resolve({ id: gate.shell.id })} /></div>
    </EmbeddedDesignerShell>
  )
}
