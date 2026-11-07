'use client'

import { useState, useEffect } from 'react'
import { History, RotateCcw, ChevronDown, ChevronRight, GitCompare, ArrowLeft, Loader2, GitBranch } from 'lucide-react'
import { LiveInstancesPanel } from './live-instances'
import { Button } from '@/components/ui/button'
import { Badge, Tag } from '@/components/ui/badge'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Tooltip } from '@/components/ui/tooltip'
import { serverRead } from '@/lib/server-read'
import { revertToVersion } from '@/app/actions/automations'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'

interface Version {
  id: string
  version_number: number
  publish_notes: string | null
  published_at: string
  published_by: string | null
  is_active: boolean
  nodes: any[]
  edges: any[]
}

interface VersionHistoryProps {
  workflowId: string
  open: boolean
  onClose: () => void
}

export function VersionHistory({ workflowId, open, onClose }: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [diffPair, setDiffPair] = useState<[string, string] | null>(null)
  const [reverting, setReverting] = useState<string | null>(null)
  // Live (waiting / paused) instances per version; the panel opens filtered to one.
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({})
  const [instancesFor, setInstancesFor] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    async function load() {
      setLoading(true)
      // Versions newest first, plus live (waiting / paused) instance counts per version.
      const { data } = await serverRead('automations.versionHistory', { workflowId })
      setVersions((data?.versions ?? []) as Version[])
      if (data?.versions.length) setLiveCounts(data.liveCounts)
      setLoading(false)
    }
    load()
  }, [open, workflowId])

  async function handleRevert(versionId: string) {
    if (!confirm('Revert the draft to this version? Your current draft will be overwritten.')) return
    setReverting(versionId)
    await revertToVersion(workflowId, versionId)
    setReverting(null)
    onClose()
    // Reload so the designer starts from the reverted draft with a fresh undo history.
    window.location.reload()
  }

  function showDiff(v1Id: string, v2Id: string) {
    setDiffPair([v1Id, v2Id])
  }

  if (!open) return null
  if (instancesFor) {
    return <LiveInstancesPanel workflowId={workflowId} initialVersionId={instancesFor} onClose={() => setInstancesFor(null)} />
  }

  const diffVersions = diffPair
    ? [versions.find(v => v.id === diffPair[0]), versions.find(v => v.id === diffPair[1])]
    : null

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        size="lg"
        className="max-h-[80vh]"
        title={<span className="flex items-center gap-2"><History size={16} className="text-fg-muted" aria-hidden="true" />{diffPair ? 'Version diff' : 'Version history'}</span>}
        description={loading ? undefined : plural(versions.length, 'version')}
      >
        <DialogBody className="pb-6">
          {loading ? (
            <div className="flex flex-col items-center py-10 text-fg-muted">
              <Loader2 size={20} className="mb-2 animate-spin" aria-hidden="true" />
              <p className="text-xs">Loading versions…</p>
            </div>
          ) : diffPair && diffVersions?.[0] && diffVersions?.[1] ? (
            /* Visual Diff View */
            <div className="space-y-3">
              <div className="mb-2 flex items-center gap-2">
                <Button variant="link" size="sm" leadingIcon={<ArrowLeft />} onClick={() => setDiffPair(null)}>
                  Back to list
                </Button>
                <span className="flex items-center gap-1 text-xs text-fg-muted">
                  <Tag mono>v{diffVersions[0].version_number}</Tag> → <Tag mono>v{diffVersions[1].version_number}</Tag>
                </span>
              </div>

              {/* Legend */}
              <div className="flex gap-3 text-2xs font-medium text-fg-muted">
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-success" /> Added</span>
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-danger" /> Removed</span>
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-warning" /> Changed</span>
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-border" /> Unchanged</span>
              </div>

              <VisualDiff before={diffVersions[0]} after={diffVersions[1]} />

              {/* Text diff for details */}
              <DiffView label="Node details" before={diffVersions[0].nodes} after={diffVersions[1].nodes} />
              <DiffView label="Edge details" before={diffVersions[0].edges} after={diffVersions[1].edges} />
              <SectionsDiff before={diffVersions[0]} after={diffVersions[1]} />
            </div>
          ) : versions.length === 0 ? (
            <EmptyState size="sm" icon={History} title="No published versions yet" description="Publish the workflow to start its version history." />
          ) : (
            /* Version List */
            <ul className="divide-y divide-border-subtle rounded-lg border border-border">
              {versions.map((v, i) => {
                const nodes = ((v.nodes as any[]) ?? [])
                const sections = nodes.filter((n: any) => n.type === 'section_group').length
                return (
                  <li key={v.id} className={`relative px-4 py-3 ${v.is_active ? 'bg-primary-wash' : ''}`}>
                    {v.is_active && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden="true" />}
                    <div className="flex items-center gap-2">
                      <Tag mono className="font-semibold">v{v.version_number}</Tag>
                      {v.is_active && <Badge tone="success" dot>Live</Badge>}
                      <Tooltip content={formatAbsolute(v.published_at)}>
                        <span className="flex-1 truncate text-xs text-fg-muted">{formatRelative(v.published_at)}</span>
                      </Tooltip>
                      {(liveCounts[v.id] ?? 0) > 0 && (
                        <Tooltip content="Live instances on this version — view or migrate them">
                          <Button variant="ghost" size="sm" leadingIcon={<GitBranch />} onClick={() => setInstancesFor(v.id)}
                            className={v.is_active ? 'text-primary-text' : 'text-warning'}>
                            {liveCounts[v.id]} live
                          </Button>
                        </Tooltip>
                      )}
                      <div className="flex gap-1">
                        {i < versions.length - 1 && (
                          <Tooltip content={`Diff v${versions[i + 1].version_number} → v${v.version_number}`}>
                            <Button variant="secondary" size="sm" leadingIcon={<GitCompare />} onClick={() => showDiff(versions[i + 1].id, v.id)}>
                              Diff
                            </Button>
                          </Tooltip>
                        )}
                        {!v.is_active && (
                          <Button variant="secondary" size="sm" leadingIcon={<RotateCcw />} loading={reverting === v.id} onClick={() => handleRevert(v.id)}>
                            Revert
                          </Button>
                        )}
                      </div>
                    </div>
                    {v.publish_notes && (
                      <p className="mt-1.5 text-ui text-fg">{v.publish_notes}</p>
                    )}
                    <div className="num mt-1 flex gap-3 text-xs text-fg-muted">
                      <span>{plural(nodes.filter((n: any) => n.type !== 'section_group').length, 'node')}</span>
                      <span>{plural((v.edges as any[])?.length ?? 0, 'edge')}</span>
                      {sections > 0 && <span>{plural(sections, 'section')}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

// ─── Diff View ───
function DiffView({ label, before, after }: { label: string; before: any; after: any }) {
  const [expanded, setExpanded] = useState(false)
  const beforeStr = JSON.stringify(before, null, 2)
  const afterStr = JSON.stringify(after, null, 2)
  const hasChanges = beforeStr !== afterStr

  // Simple line-by-line diff
  const beforeLines = beforeStr.split('\n')
  const afterLines = afterStr.split('\n')
  const maxLines = Math.max(beforeLines.length, afterLines.length)

  const diffLines: { type: 'same' | 'added' | 'removed' | 'changed'; before?: string; after?: string }[] = []
  for (let i = 0; i < maxLines; i++) {
    const b = beforeLines[i]
    const a = afterLines[i]
    if (b === a) {
      diffLines.push({ type: 'same', before: b, after: a })
    } else if (b === undefined) {
      diffLines.push({ type: 'added', after: a })
    } else if (a === undefined) {
      diffLines.push({ type: 'removed', before: b })
    } else {
      diffLines.push({ type: 'changed', before: b, after: a })
    }
  }

  const changedCount = diffLines.filter(d => d.type !== 'same').length

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-subtle px-3 py-2 text-left hover:bg-muted"
      >
        {expanded ? <ChevronDown size={14} className="text-fg-muted" /> : <ChevronRight size={14} className="text-fg-muted" />}
        <span className="text-ui font-medium text-fg">{label}</span>
        {hasChanges ? (
          <Badge tone="warning">{plural(changedCount, 'line')} changed</Badge>
        ) : (
          <Badge tone="success">No changes</Badge>
        )}
      </button>
      {expanded && (
        <div className="max-h-[300px] overflow-auto border-t border-border-subtle font-mono text-2xs leading-relaxed">
          {diffLines.map((line, i) => {
            if (line.type === 'same') return (
              <div key={i} className="px-3 py-0.5 text-fg-muted">{line.before}</div>
            )
            if (line.type === 'removed') return (
              <div key={i} className="bg-danger-wash px-3 py-0.5 text-danger">- {line.before}</div>
            )
            if (line.type === 'added') return (
              <div key={i} className="bg-success-wash px-3 py-0.5 text-success">+ {line.after}</div>
            )
            return (
              <div key={i}>
                <div className="bg-danger-wash px-3 py-0.5 text-danger">- {line.before}</div>
                <div className="bg-success-wash px-3 py-0.5 text-success">+ {line.after}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Visual Canvas Diff ───
function VisualDiff({ before, after }: { before: Version; after: Version }) {
  const beforeNodes = (before.nodes ?? []) as any[]
  const afterNodes = (after.nodes ?? []) as any[]
  const beforeEdges = (before.edges ?? []) as any[]
  const afterEdges = (after.edges ?? []) as any[]

  const beforeIds = new Set(beforeNodes.map((n: any) => n.id))
  const afterIds = new Set(afterNodes.map((n: any) => n.id))

  // Classify nodes
  type NodeDiff = { node: any; status: 'added' | 'removed' | 'changed' | 'unchanged' }
  const allNodeDiffs: NodeDiff[] = []

  for (const node of afterNodes) {
    if (!beforeIds.has(node.id)) {
      allNodeDiffs.push({ node, status: 'added' })
    } else {
      const prev = beforeNodes.find((n: any) => n.id === node.id)
      const changed = JSON.stringify({ ...prev, position: null }) !== JSON.stringify({ ...node, position: null })
      allNodeDiffs.push({ node, status: changed ? 'changed' : 'unchanged' })
    }
  }
  for (const node of beforeNodes) {
    if (!afterIds.has(node.id)) {
      allNodeDiffs.push({ node, status: 'removed' })
    }
  }

  const allNodes = allNodeDiffs.map(d => d.node)
  const maxX = Math.max(...allNodes.map((n: any) => (n.position?.x ?? 0) + 180), 400)
  const maxY = Math.max(...allNodes.map((n: any) => (n.position?.y ?? 0) + 60), 200)

  const statusColors: Record<string, string> = { added: 'var(--theme-success)', removed: 'var(--theme-danger)', changed: 'var(--theme-warning)', unchanged: 'var(--theme-surface-border)' }

  // Summary
  const added = allNodeDiffs.filter(d => d.status === 'added').length
  const removed = allNodeDiffs.filter(d => d.status === 'removed').length
  const changed = allNodeDiffs.filter(d => d.status === 'changed').length

  return (
    <div>
      <div className="num mb-2 flex gap-3 text-xs text-fg-muted">
        {added > 0 && <span className="text-success">+{added} added</span>}
        {removed > 0 && <span className="text-danger">-{removed} removed</span>}
        {changed > 0 && <span className="text-warning">{changed} changed</span>}
        {added === 0 && removed === 0 && changed === 0 && <span>No node changes</span>}
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-subtle">
        <div className="relative" style={{ width: maxX + 40, height: maxY + 40, minHeight: 150 }}>
          {/* Grid */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle, var(--theme-surface-border) 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

          {/* Edges (from after version) */}
          <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            {afterEdges.map((edge: any) => {
              const source = afterNodes.find((n: any) => n.id === edge.source)
              const target = afterNodes.find((n: any) => n.id === edge.target)
              if (!source || !target) return null
              const sx = (source.position?.x ?? 0) + 90, sy = (source.position?.y ?? 0) + 50
              const tx = (target.position?.x ?? 0) + 90, ty = (target.position?.y ?? 0)
              const isNew = !beforeEdges.some((e: any) => e.source === edge.source && e.target === edge.target)
              return (
                <line key={edge.id} x1={sx} y1={sy} x2={tx} y2={ty}
                  stroke={isNew ? 'var(--theme-success)' : 'var(--theme-muted-text)'}
                  strokeWidth={isNew ? 2 : 1}
                  opacity={isNew ? 0.7 : 0.2}
                  strokeDasharray={isNew ? '4 3' : undefined}
                />
              )
            })}
          </svg>

          {/* Nodes */}
          {allNodeDiffs.map(({ node, status }) => {
            const color = statusColors[status]
            // Render section_group nodes as larger containers
            if (node.type === 'section_group') {
              const w = node.config?.width ?? 500
              const h = status === 'removed' && node.collapsed ? 40 : (node.collapsed ? 40 : (node.config?.height ?? 300))
              const secColor = node.config?.color ?? 'var(--theme-chart-1)'
              return (
                <div
                  key={node.id}
                  className="absolute rounded-lg border-2"
                  style={{
                    left: node.position?.x ?? 0,
                    top: node.position?.y ?? 0,
                    width: node.collapsed ? 240 : w,
                    height: h,
                    borderColor: color,
                    backgroundColor: `color-mix(in srgb, ${secColor} 5%, transparent)`,
                    opacity: status === 'removed' ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-2xs" style={{ backgroundColor: `color-mix(in srgb, ${secColor} 10%, transparent)` }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-semibold truncate" style={{ color: secColor, textDecoration: status === 'removed' ? 'line-through' : undefined }}>
                      📂 {node.label}
                    </span>
                    <span className="ml-auto text-2xs text-fg-muted">{status}</span>
                  </div>
                </div>
              )
            }
            return (
              <div
                key={node.id}
                className="absolute truncate rounded-lg border-2 bg-panel px-2 py-1.5 text-2xs text-fg"
                style={{
                  left: node.position?.x ?? 0,
                  top: node.position?.y ?? 0,
                  width: 180,
                  borderColor: color,
                  opacity: status === 'removed' ? 0.5 : 1,
                  textDecoration: status === 'removed' ? 'line-through' : undefined,
                }}
              >
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-semibold truncate">{node.label}</span>
                </div>
                <p className="truncate text-fg-muted">{node.type}</p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Sections Diff ───
function SectionsDiff({ before, after }: { before: Version; after: Version }) {
  const beforeNodes = ((before.nodes ?? []) as any[]).filter(n => n.type === 'section_group')
  const afterNodes = ((after.nodes ?? []) as any[]).filter(n => n.type === 'section_group')

  if (beforeNodes.length === 0 && afterNodes.length === 0) return null

  const beforeIds = new Set(beforeNodes.map(n => n.id))
  const afterIds = new Set(afterNodes.map(n => n.id))

  type SectionDiff = { node: any; status: 'added' | 'removed' | 'changed' | 'unchanged'; childCountBefore: number; childCountAfter: number }
  const diffs: SectionDiff[] = []

  const beforeAllNodes = (before.nodes ?? []) as any[]
  const afterAllNodes = (after.nodes ?? []) as any[]

  for (const node of afterNodes) {
    const childCountAfter = afterAllNodes.filter(n => n.sectionId === node.id).length
    if (!beforeIds.has(node.id)) {
      diffs.push({ node, status: 'added', childCountBefore: 0, childCountAfter })
    } else {
      const prev = beforeNodes.find(n => n.id === node.id)
      const childCountBefore = beforeAllNodes.filter(n => n.sectionId === node.id).length
      const configChanged = JSON.stringify({ label: prev?.label, config: prev?.config }) !== JSON.stringify({ label: node.label, config: node.config })
      const childChanged = childCountBefore !== childCountAfter
      diffs.push({ node, status: configChanged || childChanged ? 'changed' : 'unchanged', childCountBefore, childCountAfter })
    }
  }
  for (const node of beforeNodes) {
    if (!afterIds.has(node.id)) {
      const childCountBefore = beforeAllNodes.filter(n => n.sectionId === node.id).length
      diffs.push({ node, status: 'removed', childCountBefore, childCountAfter: 0 })
    }
  }

  const hasChanges = diffs.some(d => d.status !== 'unchanged')
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-subtle px-3 py-2 text-left hover:bg-muted"
      >
        {expanded ? <ChevronDown size={14} className="text-fg-muted" /> : <ChevronRight size={14} className="text-fg-muted" />}
        <span className="text-ui font-medium text-fg">Sections</span>
        {hasChanges ? (
          <Badge tone="warning">{plural(diffs.filter(d => d.status !== 'unchanged').length, 'change')}</Badge>
        ) : (
          <Badge tone="success">No changes</Badge>
        )}
      </button>
      {expanded && (
        <div className="divide-y divide-border-subtle border-t border-border-subtle">
          {diffs.map(({ node, status, childCountBefore, childCountAfter }) => {
            const secColor = node.config?.color ?? 'var(--theme-chart-1)'
            const statusTone = status === 'added' ? 'success' : status === 'removed' ? 'danger' : status === 'changed' ? 'warning' : 'neutral'
            const statusText = status === 'added' ? 'text-success' : status === 'removed' ? 'text-danger' : 'text-warning'
            return (
              <div key={node.id} className="flex items-center gap-2 px-3 py-2">
                {/* Section colour from the workflow data. */}
                <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: secColor }} />
                <span className={`flex-1 truncate text-ui font-medium text-fg ${status === 'removed' ? 'line-through' : ''}`}>
                  {node.label}
                </span>
                {status === 'changed' && childCountBefore !== childCountAfter && (
                  <span className={`num text-xs ${statusText}`}>
                    {childCountBefore} → {plural(childCountAfter, 'node')}
                  </span>
                )}
                {status === 'added' && (
                  <span className={`num text-xs ${statusText}`}>+{plural(childCountAfter, 'node')}</span>
                )}
                {status === 'removed' && (
                  <span className={`num text-xs ${statusText}`}>was {plural(childCountBefore, 'node')}</span>
                )}
                <Badge tone={statusTone} dot>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
