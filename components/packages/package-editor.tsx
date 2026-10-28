'use client'

/**
 * Create / edit a package: pick root artifacts, review the automatically
 * included dependencies (and why each is there), add or leave out items,
 * choose schema-only or schema + rows per data table, and see the
 * requirements an install will ask for.
 *
 * Assets are found with the server-side AssetPicker (thousands of assets,
 * every type); the package's own list can be filtered when it gets long.
 */

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { createPackageAction, previewPackageAction, updatePackageAction } from '@/app/actions/packages'
import { addToDraft, dependenciesToLeaveOut, filterContents, membershipIndex, refKey, type AssetRefLike, type Membership } from '@/lib/packages/asset-picker'
import { AssetPicker, TYPE_ICON } from './asset-picker'
import { Modal } from './requirements-form'
import type { PackageItemInput } from '@/lib/services/packages'

type Ref = { type: string; id: string }
type Pkg = { id: string; name: string; description: string | null; readme: string | null; roots: Ref[]; items: Ref[]; excluded: Ref[]; data_modes: Record<string, string> }

const key = refKey
const selectStyle = { borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }
/** Show the filter above the package's own list from this many items. */
const FILTER_FROM = 8

export function PackageEditor({ open, pkg, onOpenChange, onSaved }: { open: boolean; pkg: Pkg | null; onOpenChange: (open: boolean) => void; onSaved: (name: string) => void }) {
  // Mounted per open (the parent renders it only while open), so state starts from the props.
  const [name, setName] = useState(pkg?.name ?? '')
  const [description, setDescription] = useState(pkg?.description ?? '')
  const [readme, setReadme] = useState(pkg?.readme ?? '')
  const [roots, setRoots] = useState<Ref[]>(pkg?.roots ?? [])
  const [items, setItems] = useState<Ref[]>(pkg?.items ?? [])
  const [excluded, setExcluded] = useState<Ref[]>(pkg?.excluded ?? [])
  const [dataModes, setDataModes] = useState<Record<string, 'schema' | 'rows'>>((pkg?.data_modes ?? {}) as Record<string, 'schema' | 'rows'>)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterShow, setFilterShow] = useState<'all' | 'added' | 'dependency'>('all')
  const escapeRef = useRef<(() => boolean) | null>(null)

  const preview = useQuery({
    queryKey: ['package-preview', roots, items, excluded, dataModes],
    queryFn: async () => { const r = await previewPackageAction({ roots: roots as PackageItemInput[], items: items as PackageItemInput[], excluded: excluded as PackageItemInput[], data_modes: dataModes }); if (!r.ok) throw new Error(r.error); return r.data },
    enabled: open && roots.length > 0,
    placeholderData: (previous) => previous,
  })
  const previewItems = useMemo(() => (roots.length ? preview.data?.items ?? [] : []), [roots.length, preview.data])
  const included = useMemo(() => new Set(previewItems.map((i) => key(i))), [previewItems])
  const membership = useMemo(() => {
    const index = membershipIndex(previewItems, excluded)
    // Before the preview catches up, what was just added still counts as in the package.
    for (const ref of roots) if (!index.has(key(ref))) index.set(key(ref), 'root')
    for (const ref of items) if (!index.has(key(ref))) index.set(key(ref), 'manual')
    return index as ReadonlyMap<string, Membership>
  }, [previewItems, excluded, roots, items])

  const add = async (refs: AssetRefLike[], withDependencies: boolean) => {
    setNotice(null)
    let draft = addToDraft({ roots, items, excluded }, refs)
    let leftOut = 0
    if (!withDependencies) {
      // Resolve once with the new items, then leave out what only they pulled in.
      const result = await previewPackageAction({ roots: draft.roots as PackageItemInput[], items: draft.items as PackageItemInput[], excluded: draft.excluded as PackageItemInput[], data_modes: dataModes })
      if (!result.ok) { setError(result.error); throw new Error(result.error) }
      const extra = dependenciesToLeaveOut(result.data.items, refs, included)
      leftOut = extra.length
      draft = { ...draft, excluded: [...draft.excluded, ...extra] }
    }
    setRoots(draft.roots as Ref[])
    setItems(draft.items as Ref[])
    setExcluded(draft.excluded as Ref[])
    setNotice(`Added ${refs.length} item${refs.length === 1 ? '' : 's'}${withDependencies ? '' : leftOut ? `; left out ${leftOut} dependenc${leftOut === 1 ? 'y' : 'ies'} (they must exist where the package is installed)` : ''}.`)
  }
  const remove = (ref: Ref) => {
    if (roots.some((r) => key(r) === key(ref))) { setRoots((list) => list.filter((r) => key(r) !== key(ref))); return }
    setItems((list) => list.filter((r) => key(r) !== key(ref)))
    setExcluded((list) => [...list, { type: ref.type, id: ref.id }])
  }
  const restore = (ref: Ref) => setExcluded((list) => list.filter((r) => key(r) !== key(ref)))

  const save = async () => {
    setBusy(true)
    setError(null)
    const input = { name, description: description || null, readme: readme || null, roots: roots as PackageItemInput[], items: items as PackageItemInput[], excluded: excluded as PackageItemInput[], data_modes: dataModes }
    const result = pkg ? await updatePackageAction(pkg.id, input) : await createPackageAction(input)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    onOpenChange(false)
    onSaved(result.data.name)
  }

  const showFilter = previewItems.length >= FILTER_FROM
  const visible = useMemo(() => (showFilter ? filterContents(previewItems, { text: filterText, type: filterType, show: filterShow }) : previewItems), [showFilter, previewItems, filterText, filterType, filterShow])
  const presentTypes = useMemo(() => {
    const out = new Map<string, string>()
    for (const item of previewItems) out.set(item.type, item.label)
    return [...out.entries()]
  }, [previewItems])
  const excludedNames = useMemo(() => new Map((preview.data?.excluded ?? []).map((e) => [key(e), e.name])), [preview.data])

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={pkg ? `Edit ${pkg.name}` : 'New package'}
      width="w-[min(54rem,94vw)]"
      onEscapeKeyDown={(event) => { if (escapeRef.current?.()) event.preventDefault() }}
    >
      {error && <InlineNotice tone="error" message={error} className="mb-3" />}
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <label className="text-xs space-y-1 block">Name <Input className="h-8 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoice approval" data-testid="package-name" /></label>
        <label className="text-xs space-y-1 block">Description <Input className="h-8 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="text-xs space-y-1 block sm:col-span-2">Readme (Markdown, shown before install)
          <textarea className="w-full rounded-lg border px-3 py-2 text-sm min-h-16" style={selectStyle} value={readme} onChange={(e) => setReadme(e.target.value)} />
        </label>
      </div>

      <AssetPicker membership={membership} emptyPackage={!roots.length} onAdd={add} escapeRef={escapeRef} />
      {notice && <p className="text-xs mb-2" style={{ color: 'var(--theme-muted-text)' }} role="status">{notice}</p>}

      {roots.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>In this package{previewItems.length ? ` (${previewItems.length})` : ''}</p>
            {showFilter && (
              <div className="ml-auto flex flex-wrap items-center gap-2 text-xs" data-testid="package-contents-filter">
                <input className="rounded border px-2 py-1 w-44" style={selectStyle} value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Filter items…" aria-label="Filter package items" data-testid="package-contents-search" />
                <select className="rounded border px-1.5 py-1" style={selectStyle} value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Item type">
                  <option value="">All types</option>
                  {presentTypes.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                </select>
                <select className="rounded border px-1.5 py-1" style={selectStyle} value={filterShow} onChange={(e) => setFilterShow(e.target.value as 'all' | 'added' | 'dependency')} aria-label="Included as">
                  <option value="all">Everything</option>
                  <option value="added">Added by you</option>
                  <option value="dependency">Dependencies</option>
                </select>
              </div>
            )}
          </div>
          <div className="rounded-lg border divide-y text-sm max-h-72 overflow-y-auto" style={{ borderColor: 'var(--theme-surface-border)' }} data-testid="package-contents">
            {preview.isLoading && <p className="px-3 py-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>Resolving dependencies…</p>}
            {visible.map((item) => {
              const Icon = TYPE_ICON[item.type]
              return (
                <div key={key(item)} className="px-3 py-2 flex items-center gap-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
                  {Icon && <Icon size={14} className="shrink-0" style={{ color: 'var(--theme-muted-text)' }} aria-hidden />}
                  <span className="text-xs w-28 shrink-0" style={{ color: 'var(--theme-muted-text)' }}>{item.label}</span>
                  <span className="truncate">{item.name}</span>
                  <span className="text-[10px] px-1.5 rounded shrink-0" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{item.included_as === 'dependency' ? 'used by the package' : item.included_as === 'root' ? 'root' : 'added'}</span>
                  {item.type === 'data_table' && (
                    <select className="ml-auto rounded border px-1.5 py-0.5 text-xs" style={selectStyle} value={dataModes[item.id] ?? 'schema'} onChange={(e) => setDataModes((m) => ({ ...m, [item.id]: e.target.value as 'schema' | 'rows' }))} aria-label={`${item.name} data`}>
                      <option value="schema">Schema only</option>
                      <option value="rows">Schema + {item.row_count ?? 0} rows</option>
                    </select>
                  )}
                  <button type="button" className={`${item.type === 'data_table' ? '' : 'ml-auto'} opacity-60 hover:opacity-100`} onClick={() => remove(item)} aria-label={`Leave out ${item.name}`}><X size={14} /></button>
                </div>
              )
            })}
            {showFilter && !visible.length && <p className="px-3 py-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>No items match the filter.</p>}
            {excluded.map((ref) => (
              <div key={`x-${key(ref)}`} className="px-3 py-1.5 flex items-center gap-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                <span className="w-28 shrink-0">Left out</span>
                <span className="truncate">{excludedNames.get(key(ref)) ?? `${ref.type.replace(/_/g, ' ')} ${ref.id.slice(0, 8)}`}</span>
                <button type="button" className="ml-auto inline-flex items-center gap-1 underline" onClick={() => restore(ref)} aria-label={`Include ${excludedNames.get(key(ref)) ?? ref.id} again`}><RotateCcw size={12} /> Include</button>
              </div>
            ))}
          </div>
          {showFilter && <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }} data-testid="package-contents-count">Showing {visible.length} of {previewItems.length}</p>}
        </>
      )}
      {(preview.data?.warnings ?? []).map((w) => <InlineNotice key={w} tone="warning" message={w} className="mt-2" />)}
      {(preview.data?.requirements ?? []).length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--theme-muted-text)' }}>Asked for on install</p>
          <ul className="text-sm space-y-0.5">
            {(preview.data?.requirements ?? []).map((r) => <li key={r.id} className="flex items-center gap-1.5"><KeyRound size={12} /> {r.label}{!r.required && <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>(optional)</span>}</li>)}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={() => void save()} disabled={busy || !name.trim() || !roots.length} data-testid="package-save">{busy ? 'Saving…' : pkg ? 'Save' : 'Create package'}</Button>
      </div>
    </Modal>
  )
}
