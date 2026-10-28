"use client"

import { use } from 'react'
import { serverQuery, serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { AgentDesigner } from '@/components/agents/agent-designer'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ObjectPermissions } from '@/components/governance/object-permissions'
import { DesktopOnly } from '@/components/layout/desktop-only'

export default function AgentDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: agent } = useQuery({
    queryKey: ['agent', id],
    queryFn: async () => (await serverRead('agents.get', { id })).data,
  })

  // Integrations, references, data tables, workflows and teams for the designer's pickers.
  const { data: options } = useQuery({
    queryKey: ['agent-designer-options'],
    queryFn: () => serverQuery('agents.designerOptions'),
  })
  const { integrations, references, dataTables, workflows, teams } = options ?? {}

  if (!agent) return null

  return (
    <DesktopOnly>
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/agents" className="rounded-md p-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-semibold">{(agent as any).name}</h1>
        <Link
          href={`/agents/${id}/runs`}
          className="ml-auto text-xs px-2.5 py-1 rounded-md border transition-colors hover:bg-[var(--theme-row-highlight)]"
          style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
        >
          View Runs →
        </Link>
      </div>
      <AgentDesigner
        agent={agent as any}
        integrations={(integrations ?? []) as any}
        references={(references ?? []) as any}
        dataTables={(dataTables ?? []) as any}
        workflows={(workflows ?? []) as any}
        teams={(teams ?? []) as any}
      />
      <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
        <ObjectPermissions objectType="agent" objectId={id} objectName={(agent as any).name} showExecute={true} />
      </div>
    </div>
    </DesktopOnly>
  )
}
