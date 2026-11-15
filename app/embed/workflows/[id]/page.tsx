import type { Metadata } from 'next'
import WorkflowBuilderPage from '@/app/(dashboard)/automations/[id]/page'
import { EmbeddedDesignerShell } from '@/components/embed/designer-shell'
import { embedDesignerGate, type Query } from '@/lib/embed/designer-route'

/**
 * Embedded workflow designer (lib/embed/designers.ts): the designer of
 * /automations/<id> without the app shell, for a page on an approved site
 * (frame-ancestors from EMBED_FRAME_ANCESTORS, proxy.ts). Same page
 * component, same permissions (workflows.view to open; the services enforce
 * edit / publish / run).
 */

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Workflow designer', robots: { index: false, follow: false } }

export default async function EmbeddedWorkflowDesigner({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params
  const gate = await embedDesignerGate({ kind: 'workflow', id, embedPath: `/embed/workflows/${id}`, appPath: `/automations/${id}`, query: await searchParams, allOf: ['workflows.view'] })
  if (gate.kind === 'node') return gate.node
  return (
    <EmbeddedDesignerShell {...gate.shell}>
      <WorkflowBuilderPage params={Promise.resolve({ id: gate.shell.id })} />
    </EmbeddedDesignerShell>
  )
}
