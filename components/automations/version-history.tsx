'use client'

import { useState, useEffect } from 'react'
import { History, RotateCcw, ChevronDown, ChevronRight, GitCompare, X, Loader2, GitBranch } from 'lucide-react'
import { LiveInstancesPanel } from './live-instances'
import { Button } from '@/components/ui/button'
import { serverRead } from '@/lib/server-read'
import { revertToVersion } from '@/app/actions/automations'
import { formatRelativeDate } from '@/lib/utils'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div
        className="w-[90vw] max-w-3xl max-h-[80vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
          <div className="flex items-center gap-2">
            <History size={16} style={{ color: 'var(--theme-primary-text)' }} />
            <span className="text-sm font-semibold">
              {diffPair ? 'Version Diff' : 'Version History'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
              {versions.length} version{versions.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center py-10">
              <Loader2 size={24} className="animate-spin mb-2" style={{ color: 'var(--theme-primary-text)' }} />
              <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>Loading versions...</p>
            </div>
          ) : diffPair && diffVersions?.[0] && diffVersions?.[1] ? (
            /* Visual Diff View */
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => setDiffPair(null)} className="text-xs underline" style={{ color: 'var(--theme-primary-text)' }}>
                  Back to list
                </button>
                <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                  v{diffVersions[0].version_number} → v{diffVersions[1].version_number}
                </span>
              </div>

              {/* Legend */}
              <div className="flex gap-3 text-[9px] font-medium">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: 'var(--theme-success)' }} /> Added</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: 'var(--theme-danger)' }} /> Removed</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: 'var(--theme-warning)' }} /> Changed</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: 'var(--theme-surface-border)' }} /> Unchanged</span>
              </div>

              <VisualDiff before={diffVersions[0]} after={diffVersions[1]} />

              {/* Text diff for details */}
              <DiffView label="Node Details" before={diffVersions[0].nodes} after={diffVersions[1].nodes} />
              <DiffView label="Edge Details" before={diffVersions[0].edges} after={diffVersions[1].edges} />
              <SectionsDiff before={diffVersions[0]} after={diffVersions[1]} />
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-10">
              <History size={32} className="mx-auto mb-2" style={{ color: 'var(--theme-muted-text)', opacity: 0.3 }} />
              <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>No published versions yet</p>
            </div>
          ) : (
            /* Version List */
            <div className="space-y-2">
              {versions.map((v, i) => (
                <div key={v.id} className="rounded-lg border p-3" style={{ borderColor: v.is_active ? 'var(--theme-primary)' : 'var(--theme-surface-border)', backgroundColor: v.is_active ? 'var(--theme-primary-light)' : 'var(--theme-surface)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: v.is_active ? 'var(--theme-primary-text)' : 'var(--theme-card-text)' }}>
                      v{v.version_number}
                    </span>
                    {v.is_active && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 15%, transparent)', color: 'var(--theme-success)' }}>
                        LIVE
                      </span>
                    )}
                    <span className="text-[10px] flex-1" style={{ color: 'var(--theme-muted-text)' }}>
                      {formatRelativeDate(v.published_at)}
                    </span>
                    {(liveCounts[v.id] ?? 0) > 0 && (
                      <button
                        onClick={() => setInstancesFor(v.id)}
                        className="text-[9px] px-2 py-1 rounded hover:opacity-80 flex items-center gap-1 font-medium"
                        style={{ color: v.is_active ? 'var(--theme-primary-text)' : 'var(--theme-warning)', backgroundColor: 'var(--theme-card-bg)' }}
                        title="Live instances on this version — view or migrate them"
                      >
                        <GitBranch size={10} /> {liveCounts[v.id]} live
                      </button>
                    )}
                    <div className="flex gap-1">
                      {i < versions.length - 1 && (
                        <button
                          onClick={() => showDiff(versions[i + 1].id, v.id)}
                          className="text-[9px] px-2 py-1 rounded hover:opacity-80 flex items-center gap-1"
                          style={{ color: 'var(--theme-primary-text)', backgroundColor: 'var(--theme-card-bg)' }}
                          title={`Diff v${versions[i + 1].version_number} → v${v.version_number}`}
                        >
                          <GitCompare size={10} /> Diff
                        </button>
                      )}
                      {!v.is_active && (
                        <button
                          onClick={() => handleRevert(v.id)}
                          disabled={reverting === v.id}
                          className="text-[9px] px-2 py-1 rounded hover:opacity-80 flex items-center gap-1"
                          style={{ color: 'var(--theme-warning)', backgroundColor: 'var(--theme-card-bg)' }}
                        >
                          {reverting === v.id ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                          Revert
                        </button>
                      )}
                    </div>
                  </div>
                  {v.publish_notes && (
                    <p className="text-[10px] mt-1.5" style={{ color: 'var(--theme-muted-text)' }}>
                      {v.publish_notes}
                    </p>
                  )}
                  <div className="flex gap-3 mt-1 text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
                    <span>{((v.nodes as any[]) ?? []).filter((n: any) => n.type !== 'section_group').length} nodes</span>
                    <span>{(v.edges as any[])?.length ?? 0} edges</span>
                    {((v.nodes as any[]) ?? []).some((n: any) => n.type === 'section_group') && (
                      <span>{((v.nodes as any[]) ?? []).filter((n: any) => n.type === 'section_group').length} sections</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
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
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:opacity-80"
        style={{ backgroundColor: 'var(--theme-surface)' }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-semibold">{label}</span>
        {hasChanges ? (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)' }}>
            {changedCount} line{changedCount !== 1 ? 's' : ''} changed
          </span>
        ) : (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 10%, transparent)', color: 'var(--theme-success)' }}>
            No changes
          </span>
        )}
      </button>
      {expanded && (
        <div className="max-h-[300px] overflow-auto font-mono text-[10px] leading-relaxed">
          {diffLines.map((line, i) => {
            if (line.type === 'same') return (
              <div key={i} className="px-3 py-0.5" style={{ color: 'var(--theme-muted-text)' }}>{line.before}</div>
            )
            if (line.type === 'removed') return (
              <div key={i} className="px-3 py-0.5" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-danger) 8%, transparent)', color: 'var(--theme-danger)' }}>- {line.before}</div>
            )
            if (line.type === 'added') return (
              <div key={i} className="px-3 py-0.5" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 8%, transparent)', color: 'var(--theme-success)' }}>+ {line.after}</div>
            )
            return (
              <div key={i}>
                <div className="px-3 py-0.5" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-danger) 8%, transparent)', color: 'var(--theme-danger)' }}>- {line.before}</div>
                <div className="px-3 py-0.5" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 8%, transparent)', color: 'var(--theme-success)' }}>+ {line.after}</div>
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
      <div className="flex gap-3 mb-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
        {added > 0 && <span style={{ color: 'var(--theme-success)' }}>+{added} added</span>}
        {removed > 0 && <span style={{ color: 'var(--theme-danger)' }}>-{removed} removed</span>}
        {changed > 0 && <span style={{ color: 'var(--theme-warning)' }}>{changed} changed</span>}
        {added === 0 && removed === 0 && changed === 0 && <span>No node changes</span>}
      </div>
      <div className="rounded-xl border overflow-auto" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
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
              const secColor = node.config?.color ?? '#6366F1'
              return (
                <div
                  key={node.id}
                  className="absolute rounded-xl border-2"
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
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[9px]" style={{ backgroundColor: `color-mix(in srgb, ${secColor} 10%, transparent)` }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-semibold truncate" style={{ color: secColor, textDecoration: status === 'removed' ? 'line-through' : undefined }}>
                      📂 {node.label}
                    </span>
                    <span className="text-[8px] ml-auto" style={{ color: 'var(--theme-muted-text)' }}>{status}</span>
                  </div>
                </div>
              )
            }
            return (
              <div
                key={node.id}
                className="absolute rounded-lg border-2 px-2 py-1.5 text-[9px] truncate"
                style={{
                  left: node.position?.x ?? 0,
                  top: node.position?.y ?? 0,
                  width: 180,
                  borderColor: color,
                  backgroundColor: `var(--theme-card-bg)`,
                  opacity: status === 'removed' ? 0.5 : 1,
                  textDecoration: status === 'removed' ? 'line-through' : undefined,
                }}
              >
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-semibold truncate">{node.label}</span>
                </div>
                <p className="truncate" style={{ color: 'var(--theme-muted-text)' }}>{node.type}</p>
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
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:opacity-80"
        style={{ backgroundColor: 'var(--theme-surface)' }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-semibold">Sections</span>
        {hasChanges ? (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)' }}>
            {diffs.filter(d => d.status !== 'unchanged').length} change{diffs.filter(d => d.status !== 'unchanged').length !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 10%, transparent)', color: 'var(--theme-success)' }}>
            No changes
          </span>
        )}
      </button>
      {expanded && (
        <div className="p-3 space-y-1.5">
          {diffs.map(({ node, status, childCountBefore, childCountAfter }) => {
            const secColor = node.config?.color ?? '#6366F1'
            const statusColor = status === 'added' ? 'var(--theme-success)' : status === 'removed' ? 'var(--theme-danger)' : status === 'changed' ? 'var(--theme-warning)' : 'var(--theme-muted-text)'
            return (
              <div key={node.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
                <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: statusColor }} />
                <span className="w-3 h-3 rounded" style={{ backgroundColor: secColor }} />
                <span className="text-xs font-medium flex-1" style={{ textDecoration: status === 'removed' ? 'line-through' : undefined, color: 'var(--theme-card-text)' }}>
                  {node.label}
                </span>
                {status === 'changed' && childCountBefore !== childCountAfter && (
                  <span className="text-[9px]" style={{ color: 'var(--theme-warning)' }}>
                    {childCountBefore} → {childCountAfter} nodes
                  </span>
                )}
                {status === 'added' && (
                  <span className="text-[9px]" style={{ color: 'var(--theme-success)' }}>+{childCountAfter} nodes</span>
                )}
                {status === 'removed' && (
                  <span className="text-[9px]" style={{ color: 'var(--theme-danger)' }}>was {childCountBefore} nodes</span>
                )}
                <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${statusColor} 10%, transparent)`, color: statusColor }}>
                  {status}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
