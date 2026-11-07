'use client'

import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { FileText, Globe, Table2, Link2, Workflow, Clock, Zap } from 'lucide-react'

interface WorkflowDependencyMap {
  runs: number
  tasks: number
  customTables: { id: string; name: string }[]
  references: { id: string; name: string }[]
  webhooks: number
  childWorkflows: { id: string; name: string }[]
}

/** Counts and named assets are resolved server-side from the workflow's definition. */
export function useWorkflowDependencies(workflowId: string) {
  return useQuery({
    queryKey: ['workflow-deps', workflowId],
    queryFn: (): Promise<WorkflowDependencyMap> => serverQuery('automations.dependencies', { workflowId }),
    staleTime: 30_000,
    enabled: !!workflowId,
  })
}

export function WorkflowDependencyMapView({ deps, loading }: { deps?: WorkflowDependencyMap; loading: boolean }) {
  if (loading) return <p className="py-2 text-center text-xs text-fg-muted">Scanning dependencies…</p>
  if (!deps) return null

  const totalDeps = deps.runs + deps.tasks + deps.customTables.length + deps.references.length + deps.webhooks + deps.childWorkflows.length
  if (totalDeps === 0) return <p className="py-2 text-center text-xs text-fg-muted">No linked assets found.</p>

  return (
    <div className="divide-y divide-border-subtle">
      {deps.runs > 0 && <DepRow icon={<Clock size={14} />} label="Runs" value={`${deps.runs}`} />}
      {deps.tasks > 0 && <DepRow icon={<FileText size={14} />} label="Tasks created" value={`${deps.tasks}`} />}
      {deps.webhooks > 0 && <DepRow icon={<Globe size={14} />} label="Webhooks" value={`${deps.webhooks}`} />}
      {deps.customTables.map(t => <DepRow key={t.id} icon={<Table2 size={14} />} label="Data table" value={t.name} href={`/data/${t.id}`} />)}
      {deps.references.map(r => <DepRow key={r.id} icon={<Link2 size={14} />} label="API reference" value={r.name} />)}
      {deps.childWorkflows.map(w => <DepRow key={w.id} icon={<Zap size={14} />} label="Child workflow" value={w.name} href={`/automations/${w.id}`} />)}
    </div>
  )
}

function DepRow({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  const content = (
    <div className="flex min-h-8 items-center gap-2 px-1 py-1.5 text-xs">
      <span className="shrink-0 text-fg-muted" aria-hidden="true">{icon}</span>
      <span className="text-fg-muted">{label}</span>
      <span className="num flex-1 truncate text-right font-medium text-fg">{value}</span>
    </div>
  )
  if (href) return <a href={href} className="block rounded-md hover:bg-subtle">{content}</a>
  return content
}

export function getWorkflowDependencyWarning(deps?: WorkflowDependencyMap): string | null {
  if (!deps) return null
  const parts: string[] = []
  if (deps.runs > 0) parts.push(`${deps.runs} run${deps.runs !== 1 ? 's' : ''}`)
  if (deps.tasks > 0) parts.push(`${deps.tasks} task${deps.tasks !== 1 ? 's' : ''}`)
  if (deps.customTables.length > 0) parts.push(`${deps.customTables.length} data table${deps.customTables.length !== 1 ? 's' : ''}`)
  if (deps.webhooks > 0) parts.push(`${deps.webhooks} webhook${deps.webhooks !== 1 ? 's' : ''}`)
  if (parts.length === 0) return null
  return `This workflow is linked to ${parts.join(', ')}. Deleting it may affect these assets.`
}
