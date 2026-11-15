import type { Metadata } from 'next'
import ProcessViewPage from '@/app/(dashboard)/automations/runs/[id]/page'
import { EmbeddedDesignerShell } from '@/components/embed/designer-shell'
import { embedDesignerGate, type Query } from '@/lib/embed/designer-route'

/** Embedded: one workflow run (/automations/runs/<id> without the app shell, lib/embed/designers.ts). */

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Workflow run', robots: { index: false, follow: false } }

export default async function EmbeddedWorkflowRun({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params
  const gate = await embedDesignerGate({ kind: 'run', id, embedPath: `/embed/runs/${id}`, appPath: `/automations/runs/${id}`, query: await searchParams, allOf: ['workflows.view_queue'] })
  if (gate.kind === 'node') return gate.node
  return (
    <EmbeddedDesignerShell {...gate.shell}>
      <div className="p-2"><ProcessViewPage params={Promise.resolve({ id: gate.shell.id })} /></div>
    </EmbeddedDesignerShell>
  )
}
