'use client'

/**
 * Run Agent step → which agent version the PUBLISHED workflow runs:
 * "Published runs use v3 · newer v5 available — Update" (re-pins the live
 * version without publishing draft changes), "Published runs use v5
 * (latest)", or, before the first publish / for a step added since, that the
 * draft follows the latest version and publishing pins it.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pin } from 'lucide-react'
import { serverRead } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { updatePinnedAgentVersion } from '@/app/actions/automations'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function AgentPinBadge({ workflowId, nodeId, agentId, latestVersion }: { workflowId?: string; nodeId: string; agentId?: string; latestVersion?: number | null }) {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data } = useQuery({
    queryKey: ['workflow-agent-pins', workflowId],
    enabled: Boolean(workflowId),
    // Always fresh: a publish or an agent save elsewhere changes the answer.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    queryFn: async () => (await serverRead('automations.agentPins', { workflowId: workflowId! })).data,
  })
  if (!workflowId || !agentId) return null
  const pin = data?.pins?.find((p: any) => p.node_id === nodeId && p.agent_id === agentId)
  const box = 'rounded-md px-2 py-1.5 text-xs flex flex-wrap items-center gap-1.5'

  if (!pin || pin.version == null) {
    return (
      <div className={cn(box, 'bg-subtle text-fg-muted')} data-testid="agent-pin-badge" data-state="unpinned">
        <Pin size={12} className="shrink-0" aria-hidden />
        <span>Draft and Save &amp; Test use the latest agent version{latestVersion ? ` (v${latestVersion})` : ''}. Publishing pins this step to it.</span>
      </div>
    )
  }
  const newer = pin.current_version != null && pin.current_version > pin.version
  return (
    <div className={cn(box, 'text-fg', newer ? 'bg-warning-wash' : 'bg-subtle')}
      data-testid="agent-pin-badge" data-state={newer ? 'outdated' : 'current'}>
      <Pin size={12} className="shrink-0" aria-hidden />
      <span className="font-medium">Pinned to v{pin.version}</span>
      {newer ? <span className="text-fg-muted">· newer v{pin.current_version} available</span> : <span className="text-fg-muted">· latest</span>}
      {data?.published_version_number != null && <span className="text-fg-muted">(published version {data.published_version_number})</span>}
      {newer && can('workflows.activate') && (
        <Button type="button" variant="secondary" size="sm" disabled={busy} className="ml-auto"
          onClick={async () => {
            setBusy(true); setError(null)
            const result = await updatePinnedAgentVersion(workflowId, nodeId)
            if (!result.ok) setError(result.error)
            await queryClient.invalidateQueries({ queryKey: ['workflow-agent-pins', workflowId] })
            setBusy(false)
          }}>
          {busy ? 'Updating…' : `Update to v${pin.current_version}`}
        </Button>
      )}
      {error && <span className="w-full text-danger">{error}</span>}
    </div>
  )
}
