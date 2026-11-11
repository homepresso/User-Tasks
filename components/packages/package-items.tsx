'use client'

/**
 * Package items (Packages → Authored here, and the item list of an install):
 *
 * - PackageItemsSection: the items of an authored package grouped by type,
 *   "Unpublished changes" since the last built version, Add items (the asset
 *   picker; what they use is offered too, "Add with dependencies" ticked) and
 *   Remove per item (warns when another item in the package uses it, with
 *   "Remove anyway"). Changes edit the package's draft; Build new version
 *   publishes them (and updates the install here for self-installed packages).
 * - InstallItemsList: the items an install owns, with "Remove from package"
 *   (uninstall keeps it) per item and "Add to package" (uninstall removes it)
 *   for packages authored in this workspace.
 *
 * Services: lib/services/package-items, package-installs (detach / adopt).
 */

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Hammer, PackageMinus, PackagePlus, Plus, X } from 'lucide-react'
import { plural, pluralForm } from '@/lib/format/plural'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Tooltip } from '@/components/ui/tooltip'
import {
  addPackageItemsAction, adoptInstallItemsAction, detachInstallItemsAction, listPackageItemsAction, removePackageItemsAction,
} from '@/app/actions/packages'
import { refKey, type AssetRefLike, type Membership } from '@/lib/packages/asset-picker'
import type { PackageItemInput } from '@/lib/services/packages'
import { AssetPicker, TYPE_ICON } from './asset-picker'
import { Modal } from './requirements-form'

/* eslint-disable @typescript-eslint/no-explicit-any -- install asset rows are loose JSON */

type Notice = { tone: 'success' | 'warning' | 'error'; message: string }
export type PackageItems = Extract<Awaited<ReturnType<typeof listPackageItemsAction>>, { ok: true }>['data']
type Item = PackageItems['items'][number]
type AddPlan = Extract<Awaited<ReturnType<typeof addPackageItemsAction>>, { ok: true }>['data']
type RemovePlan = Extract<Awaited<ReturnType<typeof removePackageItemsAction>>, { ok: true }>['data']
type InstallPlan = Extract<Awaited<ReturnType<typeof detachInstallItemsAction>>, { ok: true }>['data']

export function packageItemsKey(packageId: string) { return ['package-items', packageId] }

export function usePackageItems(packageId: string, enabled = true) {
  return useQuery({
    queryKey: packageItemsKey(packageId),
    queryFn: async () => { const r = await listPackageItemsAction(packageId); if (!r.ok) throw new Error(r.error); return r.data },
    enabled,
  })
}

const asInput = (refs: AssetRefLike[]) => refs.map((r) => ({ type: r.type, id: r.id })) as PackageItemInput[]
const typeLabel = (label: string) => label.toLowerCase()

function includedLabel(item: Item): { text: string; tone: 'brand' | 'neutral' } {
  if (item.included_as === 'root') return { text: 'Root', tone: 'brand' }
  if (item.included_as === 'manual') return { text: 'Added', tone: 'brand' }
  return { text: item.required_by ? `Used by ${item.required_by.name}` : 'Dependency', tone: 'neutral' }
}

export function UnpublishedBadge({ changes }: { changes: PackageItems['changes'] }) {
  if (!changes.unpublished) return null
  const parts = changes.since_version
    ? [changes.added.length ? `${changes.added.length} added` : '', changes.removed.length ? `${changes.removed.length} removed` : ''].filter(Boolean).join(', ')
    : 'never built'
  return (
    <Tooltip content={changes.since_version ? `Since version ${changes.since_version}. Build a new version to publish the changes.` : 'Build a first version to publish the package.'}>
      <span data-testid="package-unpublished"><Badge tone="warning" dot>Unpublished changes{parts ? ` · ${parts}` : ''}</Badge></span>
    </Tooltip>
  )
}

export function PackageItemsSection({ packageId, data, isLoading, canManage, onChanged, onNotice, onBuild }: {
  packageId: string
  data: PackageItems | undefined
  isLoading: boolean
  canManage: boolean
  onChanged: () => void
  onNotice: (n: Notice) => void
  onBuild: () => void
}) {
  const [open, setOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [removing, setRemoving] = useState<Item | null>(null)
  const items = data?.items ?? []
  const groups = data?.groups ?? []

  return (
    <div className="border-t border-border-subtle" data-testid="package-items">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <button type="button" className="inline-flex items-center gap-1.5 text-ui font-medium text-fg" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="package-items-toggle">
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          Items{data ? <span className="num font-normal text-fg-muted">{items.length}</span> : null}
        </button>
        {!open && groups.length > 0 && <span className="truncate text-xs text-fg-muted">{groups.map((g) => plural(g.count, typeLabel(g.label), pluralForm(typeLabel(g.label)))).join(' · ')}</span>}
        {data && <UnpublishedBadge changes={data.changes} />}
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => { setOpen(true); setAddOpen(true) }} data-testid="package-items-add">Add items</Button>
            {data?.changes.unpublished && <Button size="sm" leadingIcon={<Hammer />} onClick={onBuild} data-testid="package-build-new">Build new version</Button>}
          </div>
        )}
      </div>
      {open && (
        <div className="px-4 pb-4">
          {isLoading && !data && <p className="text-xs text-fg-muted" role="status">Loading items…</p>}
          {data && (
            <div className="divide-y divide-border-subtle rounded-lg border border-border text-ui">
              {groups.map((group) => {
                const Icon = TYPE_ICON[group.type]
                return (
                  <div key={group.type} data-testid={`package-items-group-${group.type}`}>
                    <p className="flex items-center gap-1.5 bg-subtle px-3 py-1.5 text-xs font-medium text-fg-muted">
                      {Icon && <Icon size={14} aria-hidden />}{pluralForm(group.label)} <span className="num font-normal">{group.count}</span>
                    </p>
                    {items.filter((item) => item.type === group.type).map((item) => {
                      const badge = includedLabel(item)
                      const added = data.changes.added.some((a) => a.type === item.type && a.id === item.id) && data.changes.since_version
                      return (
                        <div key={refKey(item)} className="flex min-h-9 items-center gap-2 px-3 py-1" data-testid="package-item">
                          <span className="min-w-0 truncate text-fg">{item.name || 'untitled'}</span>
                          <Badge tone={badge.tone}>{badge.text}</Badge>
                          {added && <Badge tone="warning">New</Badge>}
                          {item.used_by.length > 0 && item.included_as !== 'dependency' && (
                            <span className="hidden truncate text-xs text-fg-muted md:inline">used by {item.used_by.slice(0, 2).map((u) => u.name).join(', ')}{item.used_by.length > 2 ? ` +${item.used_by.length - 2}` : ''}</span>
                          )}
                          {canManage && <IconButton size="sm" className="ml-auto" label={`Remove ${item.name} from the package`} icon={<X />} onClick={() => setRemoving(item)} data-testid="package-item-remove" />}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              {data.changes.removed.length > 0 && (
                <div className="px-3 py-1.5 text-xs text-fg-muted" data-testid="package-items-removed">
                  Removed since {data.changes.since_version}: {data.changes.removed.map((r) => `${typeLabel(r.label)} “${r.name}”`).join(', ')}
                </div>
              )}
              {data.excluded.length > 0 && (
                <div className="px-3 py-1.5 text-xs text-fg-muted">
                  Left out: {data.excluded.map((r) => `${typeLabel(r.label)} “${r.name ?? r.id.slice(0, 8)}”`).join(', ')} — add them again to include them.
                </div>
              )}
            </div>
          )}
          {data?.install && <p className="mt-2 text-xs text-fg-muted">Installed here (v{data.install.version}): building a new version can update that install, so uninstall removes what you add and keeps what you remove.</p>}
        </div>
      )}
      {addOpen && data && (
        <AddItemsDialog packageId={packageId} data={data} onOpenChange={setAddOpen}
          onDone={(message) => { onNotice({ tone: 'success', message }); onChanged() }} />
      )}
      {removing && (
        <RemoveItemDialog packageId={packageId} item={removing} onClose={() => setRemoving(null)}
          onDone={(message) => { onNotice({ tone: 'success', message }); onChanged() }} />
      )}
    </div>
  )
}

function AddItemsDialog({ packageId, data, onOpenChange, onDone }: { packageId: string; data: PackageItems; onOpenChange: (open: boolean) => void; onDone: (message: string) => void }) {
  const [plan, setPlan] = useState<{ refs: AssetRefLike[]; result: AddPlan } | null>(null)
  const [withDeps, setWithDeps] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const escapeRef = useRef<(() => boolean) | null>(null)
  const membership = useMemo(() => {
    const index = new Map<string, Membership>()
    for (const item of data.items) index.set(refKey(item), item.included_as)
    for (const ref of data.excluded) if (!index.has(refKey(ref))) index.set(refKey(ref), 'excluded')
    return index as ReadonlyMap<string, Membership>
  }, [data])

  const apply = async (refs: AssetRefLike[], deps: boolean) => {
    setBusy(true)
    setError(null)
    const r = await addPackageItemsAction(packageId, { items: asInput(refs), with_dependencies: deps })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    const extra = r.data.dependencies.length
    onDone(`Added ${plural(refs.length, 'item')}${extra ? (deps ? ` and ${plural(extra, 'dependency', 'dependencies')}` : `; left out ${plural(extra, 'dependency', 'dependencies')}`) : ''}. Build a new version to publish the change.`)
    onOpenChange(false)
  }
  // The picker's "Include dependencies" pre-sets the choice; new dependencies are shown before anything changes.
  const onAdd = async (refs: AssetRefLike[], deps: boolean) => {
    setError(null)
    const r = await addPackageItemsAction(packageId, { items: asInput(refs), with_dependencies: deps, dry_run: true })
    if (!r.ok) { setError(r.error); throw new Error(r.error) }
    if (!r.data.dependencies.length) { await apply(refs, deps); return }
    setWithDeps(deps)
    setPlan({ refs, result: r.data })
  }

  return (
    <Modal open onOpenChange={onOpenChange} size="xl" title={`Add items to ${data.package.name}`}
      description="Search the workspace. Items are added to the package's draft — nothing in the workspace changes. Build a new version to publish them."
      onEscapeKeyDown={(event) => { if (escapeRef.current?.()) event.preventDefault() }}
      footer={plan ? <>
        <Button variant="secondary" onClick={() => setPlan(null)} disabled={busy}>Back</Button>
        <Button onClick={() => void apply(plan.refs, withDeps)} loading={busy} data-testid="package-items-add-confirm">
          {withDeps ? `Add ${plural(plan.refs.length + plan.result.dependencies.length, 'item')}` : `Add ${plural(plan.refs.length, 'item')}`}
        </Button>
      </> : <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>}>
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}
      {plan ? (
        <div className="space-y-3" data-testid="package-items-dependencies">
          <p className="text-ui text-fg">
            Adding {plan.result.adding.map((a) => `${typeLabel(a.label)} “${a.name}”`).join(', ')}. {plan.result.adding.length === 1 ? 'It uses' : 'They use'} {plan.result.dependencies.length === 1 ? 'an item that is' : 'items that are'} not in the package yet:
          </p>
          <ul className="divide-y divide-border-subtle rounded-lg border border-border text-ui">
            {plan.result.dependencies.map((dep) => {
              const Icon = TYPE_ICON[dep.type]
              return (
                <li key={refKey(dep)} className="flex min-h-9 items-center gap-2 px-3 py-1">
                  {Icon && <Icon size={14} className="shrink-0 text-fg-muted" aria-hidden />}
                  <span className="w-28 shrink-0 text-xs text-fg-muted">{dep.label}</span>
                  <span className="truncate text-fg">{dep.name}</span>
                  {dep.required_by && <span className="truncate text-xs text-fg-muted">used by {dep.required_by.name}</span>}
                  {dep.left_out && <Badge>Left out before</Badge>}
                </li>
              )
            })}
          </ul>
          <Checkbox checked={withDeps} onChange={(e) => setWithDeps(e.target.checked)} data-testid="package-items-with-deps" label="Add with dependencies"
            description={withDeps ? 'Recommended: the package then works wherever it is installed.' : 'They are left out: they must already exist where the package is installed.'} />
        </div>
      ) : (
        <AssetPicker membership={membership} emptyPackage={false} onAdd={onAdd} escapeRef={escapeRef} />
      )}
    </Modal>
  )
}

function RemoveItemDialog({ packageId, item, onClose, onDone }: { packageId: string; item: Item; onClose: () => void; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = [{ type: item.type, id: item.id }] as PackageItemInput[]
  const plan = useQuery({
    queryKey: ['package-item-remove-plan', packageId, item.type, item.id],
    queryFn: async () => { const r = await removePackageItemsAction(packageId, { items: ref, dry_run: true }); if (!r.ok) throw new Error(r.error); return r.data as RemovePlan },
  })
  const dependents = plan.data?.dependents.length ?? 0
  const remove = async () => {
    setBusy(true)
    setError(null)
    const r = await removePackageItemsAction(packageId, { items: ref, force: dependents > 0 })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone(`Removed ${typeLabel(item.label)} “${item.name}” from the package (it stays in the workspace). Build a new version to publish the change.`)
    onClose()
  }
  return (
    <Modal open onOpenChange={(open) => { if (!open && !busy) onClose() }} size="sm" title={`Remove “${item.name}” from the package?`}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={() => void remove()} loading={busy} disabled={plan.isLoading} data-testid="package-item-remove-confirm">{dependents ? 'Remove anyway' : 'Remove'}</Button>
      </>}>
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}
      {plan.isLoading && <p className="text-xs text-fg-muted" role="status">Checking what uses it…</p>}
      {plan.error && <InlineNotice tone="error" message={(plan.error as Error).message} />}
      {plan.data && (
        <div className="space-y-3 text-ui text-fg-muted">
          {dependents > 0 && (
            <InlineNotice tone="warning" title="Other items in the package use it" message={plan.data.warnings.join('. ')} />
          )}
          <p>
            {dependents > 0
              ? 'Removed anyway, it is left out of the package: wherever the package is installed, it must already exist.'
              : 'Nothing in the workspace is deleted.'} Build a new version to publish the change.
          </p>
        </div>
      )}
    </Modal>
  )
}

// ─── Installed packages ─────────────────────────────────────────────────────

export function InstallItemsList({ install, details, canInstall, onChanged, onNotice }: {
  install: { id: string; name: string }
  details: { assets: any[]; data_rows: number; authored_package: { id: string; name: string } | null; detached?: any[] } | undefined
  canInstall: boolean
  onChanged: () => void
  onNotice: (n: Notice) => void
}) {
  const [detaching, setDetaching] = useState<any | null>(null)
  const [adoptOpen, setAdoptOpen] = useState(false)
  const assets = (details?.assets ?? []).filter((a: any) => a.section !== 'references' && a.section !== 'objects')
  const authored = details?.authored_package ?? null
  return (
    <div data-testid="install-items">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-medium text-fg-muted">Installed assets</p>
        {canInstall && authored && <Button size="sm" variant="ghost" className="ml-auto" leadingIcon={<PackagePlus />} onClick={() => setAdoptOpen(true)} data-testid="install-adopt">Add to package</Button>}
      </div>
      <ul className="max-h-56 space-y-0.5 overflow-y-auto scrollbar-thin text-ui">
        {assets.map((asset: any) => (
          <li key={asset.id} className="group flex min-h-7 items-center gap-2" data-testid="install-asset">
            <span className="w-28 shrink-0 text-xs text-fg-muted first-letter:uppercase">{String(asset.section).replace(/_/g, ' ')}</span>
            <span className="truncate text-fg">{asset.name}</span>
            {asset.status === 'needs_config' && <Badge tone="warning">Needs configuration</Badge>}
            {asset.status === 'removed_upstream' && <Badge>Not in this version</Badge>}
            {canInstall && (
              <IconButton size="sm" className="ml-auto opacity-60 group-hover:opacity-100 focus-visible:opacity-100" label={`Remove ${asset.name} from the package (keep it in the workspace)`} icon={<PackageMinus />}
                onClick={() => setDetaching(asset)} data-testid="install-detach" />
            )}
          </li>
        ))}
        {details && details.data_rows > 0 && <li className="num text-xs text-fg-muted">{plural(details.data_rows, 'table row')}</li>}
      </ul>
      {(details?.detached ?? []).length > 0 && (
        <p className="mt-2 text-xs text-fg-muted">Removed from the package (kept on uninstall): {(details!.detached ?? []).map((d: any) => d.name ?? d.local_id).join(', ')}</p>
      )}
      {details && !authored && canInstall && <p className="mt-2 text-xs text-fg-muted">Installed from outside this workspace: items can be removed from it, not added.</p>}
      {detaching && (
        <DetachDialog install={install} asset={detaching} authored={authored} onClose={() => setDetaching(null)}
          onDone={(message) => { onNotice({ tone: 'success', message }); onChanged() }} />
      )}
      {adoptOpen && authored && (
        <AdoptDialog install={install} assets={assets} authored={authored} onOpenChange={setAdoptOpen}
          onDone={(message, tone) => { onNotice({ tone, message }); onChanged() }} />
      )}
    </div>
  )
}

function DetachDialog({ install, asset, authored, onClose, onDone }: { install: { id: string; name: string }; asset: any; authored: { name: string } | null; onClose: () => void; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const items = [{ type: asset.asset_type, id: String(asset.local_id) }] as PackageItemInput[]
  const plan = useQuery({
    queryKey: ['install-detach-plan', install.id, asset.id],
    queryFn: async () => { const r = await detachInstallItemsAction(install.id, { items, dry_run: true }); if (!r.ok) throw new Error(r.error); return r.data as InstallPlan },
  })
  const detach = async () => {
    setBusy(true)
    setError(null)
    const r = await detachInstallItemsAction(install.id, { items })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone(`“${asset.name}” is no longer part of ${install.name}: uninstalling the package keeps it.${r.data.package_updated ? ' It is removed from the package too — build a new version to publish that.' : ''}`)
    onClose()
  }
  const users = plan.data?.used_by[0]?.used_by ?? []
  return (
    <Modal open onOpenChange={(open) => { if (!open && !busy) onClose() }} size="sm" title={`Remove “${asset.name}” from ${install.name}?`}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void detach()} loading={busy} disabled={plan.isLoading} data-testid="install-detach-confirm">Remove from package</Button>
      </>}>
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}
      <div className="space-y-3 text-ui text-fg-muted">
        <p>It stays in the workspace, and uninstalling the package no longer deletes it.{authored ? ` It is also removed from the package “${authored.name}”, so its next version leaves it out.` : ' Later upgrades of the package leave it alone.'}</p>
        {users.length > 0 && <InlineNotice tone="info" message={`Still in the package and using it: ${users.map((u: any) => u.name ?? u.id).join(', ')}. Uninstalling removes ${users.length === 1 ? 'that' : 'those'} but keeps this one.`} />}
        {(plan.data?.warnings ?? []).filter((w) => /manage/.test(w)).map((w) => <InlineNotice key={w} tone="warning" message={w} />)}
      </div>
    </Modal>
  )
}

function AdoptDialog({ install, assets, authored, onOpenChange, onDone }: { install: { id: string; name: string }; assets: any[]; authored: { name: string }; onOpenChange: (open: boolean) => void; onDone: (message: string, tone: 'success' | 'warning') => void }) {
  const [pending, setPending] = useState<AssetRefLike[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const escapeRef = useRef<(() => boolean) | null>(null)
  const membership = useMemo(() => new Map<string, Membership>(assets.map((a: any) => [`${a.asset_type}:${a.local_id}`, 'manual'])) as ReadonlyMap<string, Membership>, [assets])
  const adopt = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    const r = await adoptInstallItemsAction(install.id, { items: asInput(pending) })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    const n = r.data.items.length
    onDone(`${plural(n, 'item')} added to ${install.name}: uninstalling the package now removes ${n === 1 ? 'it' : 'them'}.${r.data.package_updated ? ' Added to the package too — build a new version to publish that.' : ''}${r.data.warnings.length ? ` ${r.data.warnings.join(' ')}` : ''}`, r.data.warnings.length ? 'warning' : 'success')
    onOpenChange(false)
  }
  return (
    <Modal open onOpenChange={onOpenChange} size="xl" title={`Add items to ${install.name}`}
      description={`Uninstalling the package will remove the items you add. They are added to “${authored.name}” (authored here) too, so its next version includes them.`}
      onEscapeKeyDown={(event) => { if (escapeRef.current?.()) event.preventDefault() }}
      footer={pending ? <>
        <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>Back</Button>
        <Button onClick={() => void adopt()} loading={busy} data-testid="install-adopt-confirm">Add to package</Button>
      </> : <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>}>
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}
      {pending ? (
        <div className="space-y-2 text-ui text-fg">
          <p>Add {plural(pending.length, 'item')} to {install.name}? Uninstalling the package will delete {pending.length === 1 ? 'it' : 'them'} with the rest of the package.</p>
        </div>
      ) : (
        <AssetPicker membership={membership} emptyPackage={false} onAdd={(refs) => { setPending(refs) }} escapeRef={escapeRef} />
      )}
    </Modal>
  )
}
