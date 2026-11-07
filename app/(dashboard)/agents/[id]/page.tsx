"use client"

import { use } from 'react'
import { serverQuery, serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { AgentDesigner } from '@/components/agents/agent-designer'
import { Card } from '@/components/ui/card'
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
  const { integrations, references, dataTables, workflows, teams, mcpServers, members } = options ?? {}

  // Wait for the pickers too: the designer keeps its own state from the first render.
  if (!agent || !options) return null

  return (
    <DesktopOnly>
    <div>
      {/* AgentDesigner renders the page header (breadcrumbs, status, View runs / Test / Save). */}
      <AgentDesigner
        agent={agent as any}
        integrations={(integrations ?? []) as any}
        references={(references ?? []) as any}
        dataTables={(dataTables ?? []) as any}
        workflows={(workflows ?? []) as any}
        teams={(teams ?? []) as any}
        mcpServers={(mcpServers ?? []) as any}
        members={(members ?? []) as any}
      />
      <Card padding="md" className="mt-4">
        <ObjectPermissions objectType="agent" objectId={id} objectName={(agent as any).name} showExecute={true} />
      </Card>
    </div>
    </DesktopOnly>
  )
}
