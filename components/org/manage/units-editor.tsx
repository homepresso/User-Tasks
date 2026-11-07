'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, FolderInput, GripVertical, MoreHorizontal, Plus, Trash2, Unlink, Users } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { deleteOrgUnit, detachOrgUnit, updateOrgUnit } from '@/app/actions/org'
import { cn } from '@/lib/utils'
import { KindBadge, SourceBadge } from '../shared'
import { flattenTree, parentTree } from '../tree-data'
import { useOrgRefresh } from '../use-org-refresh'
import { personName, type OrgUnitNode } from '../types'
import { InlineText } from './inline-text'
import { CreateUnitDialog, MoveUnitDialog, HeadDialog } from './unit-dialogs'
import { UnitMembersPanel } from './unit-members-panel'

/**
 * Manage → Org units: the unit tree with create, rename, move (drag a row
 * onto another, or "Move to…"), head, members, detach and delete.
 * Imported units are read-only until detached.
 */
export function UnitsEditor() {
  const refresh = useOrgRefresh()
  const { data, isLoading } = useQuery({ queryKey: ['org', 'units'], queryFn: () => serverQuery('org.units') })
  const tree = useMemo(() => (data ? parentTree(data.units, data.roots) : null), [data])
  const byId = useMemo(() => new Map((data?.units ?? []).map((u) => [u.id, u])), [data])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
  const [moving, setMoving] = useState<OrgUnitNode | null>(null)
  const [heading, setHeading] = useState<OrgUnitNode | null>(null)
  const [deleting, setDeleting] = useState<OrgUnitNode | null>(null)
  const [membersOf, setMembersOf] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const expanded = useMemo(() => new Set((data?.units ?? []).map((u) => u.id).filter((id) => !collapsed.has(id))), [data, collapsed])
  const rows = tree ? flattenTree(tree, expanded) : []

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    const result = await fn()
    if (!result.ok) { setError(result.error ?? 'Something went wrong'); return false }
    await refresh()
    return true
  }

  /** Is `candidate` the unit itself or below it? (No drop / move there.) */
  const isInside = (unitId: string, candidate: string | null) => {
    let current: string | null = candidate
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      if (current === unitId) return true
      seen.add(current)
      current = byId.get(current)?.parent_id ?? null
    }
    return false
  }

  function drop(targetId: string | null) {
    const id = dragId
    setDragId(null)
    setDropTarget(null)
    if (!id || isInside(id, targetId) || byId.get(id)?.parent_id === targetId) return
    void act(() => updateOrgUnit(id, { parent_id: targetId }))
  }

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-3" data-units-editor>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">Drag a unit onto another to move it under it, or onto “Top level”.</p>
        <Button leadingIcon={<Plus />} onClick={() => setCreating({ parentId: null })}>New org unit</Button>
      </div>
      {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
      {data.units.length === 0 ? (
        <EmptyState icon={Building2} title="No org units yet" description="Start with your company or divisions, then add departments under them." action={{ label: 'New org unit', onClick: () => setCreating({ parentId: null }) }} />
      ) : (
        <div className="rounded-lg border border-border-subtle bg-panel">
          <div
            onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropTarget('__root') } }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => { e.preventDefault(); drop(null) }}
            className={cn('border-b border-border-subtle px-3 py-1.5 text-xs text-fg-muted', dropTarget === '__root' && 'bg-primary-wash text-primary-text')}
          >
            Top level
          </div>
          <ul role="tree" aria-label="Org units" className="divide-y divide-border-subtle">
            {rows.map(({ id, depth }) => {
              const u = byId.get(id)!
              const kids = u.child_ids.length
              const editable = !u.read_only
              return (
                <li key={id} role="treeitem" aria-level={depth + 1} aria-expanded={kids ? expanded.has(id) : undefined} aria-selected={false} data-unit-row={id}>
                  <div
                    draggable={editable}
                    onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
                    onDragEnd={() => { setDragId(null); setDropTarget(null) }}
                    onDragOver={(e) => { if (dragId && !isInside(dragId, id)) { e.preventDefault(); setDropTarget(id) } }}
                    onDragLeave={() => setDropTarget((t) => (t === id ? null : t))}
                    onDrop={(e) => { e.preventDefault(); drop(id) }}
                    className={cn('flex items-center gap-2 py-1.5 pr-2', dropTarget === id && 'bg-primary-wash', dragId === id && 'opacity-50')}
                    style={{ paddingLeft: 8 + Math.min(depth, 12) * 20 }}
                  >
                    {editable ? <GripVertical className="size-3.5 shrink-0 cursor-grab text-fg-subtle" aria-hidden /> : <span className="size-3.5 shrink-0" />}
                    {kids ? (
                      <button type="button" aria-label={expanded.has(id) ? `Collapse ${u.name}` : `Expand ${u.name}`} className="flex size-6 items-center justify-center rounded text-fg-muted hover:bg-subtle"
                        onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })}>
                        {expanded.has(id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    ) : <span className="size-6 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <InlineText value={u.name} label={`Name of ${u.name}`} disabled={!editable} className="font-medium text-fg"
                        onSave={(name) => (name ? act(() => updateOrgUnit(id, { name })) : Promise.resolve(false))} />
                    </div>
                    <KindBadge kind={u.kind} />
                    <SourceBadge source={u.source} detached={u.detached} />
                    <button type="button" disabled={!editable} onClick={() => setHeading(u)} className="hidden max-w-40 truncate rounded px-1 text-xs text-fg-muted hover:bg-subtle sm:block" aria-label={`Head of ${u.name}`}>
                      {u.head ? personName(u.head) : 'No head'}
                    </button>
                    <button type="button" onClick={() => setMembersOf((m) => (m === id ? null : id))} className="flex items-center gap-0.5 rounded px-1 text-xs tabular-nums text-fg-muted hover:bg-subtle"
                      aria-label={`${u.member_count} members of ${u.name}`} aria-expanded={membersOf === id}>
                      <Users className="size-3" aria-hidden />{u.member_count}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><IconButton size="sm" variant="ghost" label={`Actions for ${u.name}`} icon={<MoreHorizontal />} /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem icon={<Plus />} onSelect={() => setCreating({ parentId: id })}>Add sub-unit</DropdownMenuItem>
                        <DropdownMenuItem icon={<Users />} onSelect={() => setMembersOf(id)}>Members</DropdownMenuItem>
                        {editable && <DropdownMenuItem icon={<FolderInput />} onSelect={() => setMoving(u)}>Move to…</DropdownMenuItem>}
                        {editable && <DropdownMenuItem onSelect={() => setHeading(u)}>Set head…</DropdownMenuItem>}
                        {!editable && <DropdownMenuItem icon={<Unlink />} onSelect={() => void act(() => detachOrgUnit(id))}>Detach to edit</DropdownMenuItem>}
                        {editable && <><DropdownMenuSeparator /><DropdownMenuItem danger icon={<Trash2 />} onSelect={() => setDeleting(u)}>Delete</DropdownMenuItem></>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {membersOf === id && <UnitMembersPanel unitId={id} onError={setError} />}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <CreateUnitDialog open={!!creating} parentId={creating?.parentId ?? null} units={data.units} onClose={() => setCreating(null)} onError={setError} />
      <MoveUnitDialog unit={moving} units={data.units} isInside={isInside} onClose={() => setMoving(null)} onMove={(parentId) => act(() => updateOrgUnit(moving!.id, { parent_id: parentId }))} />
      <HeadDialog unit={heading} onClose={() => setHeading(null)} onSave={(userId) => act(() => updateOrgUnit(heading!.id, { head_user_id: userId }))} />
      <ConfirmDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }} destructive
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="Its sub-units move up one level; its memberships are removed and its teams and projects lose the link. People are not affected."
        confirmLabel="Delete unit"
        onConfirm={async () => { if (deleting) await act(() => deleteOrgUnit(deleting.id)); setDeleting(null) }} />
    </div>
  )
}
