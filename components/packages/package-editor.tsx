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
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/ui/field'
import { Input, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { InlineNotice } from '@/components/ui/inline-notice'
import { createPackageAction, previewPackageAction, updatePackageAction } from '@/app/actions/packages'
import { addToDraft, dependenciesToLeaveOut, filterContents, membershipIndex, refKey, type AssetRefLike, type Membership } from '@/lib/packages/asset-picker'
import { AssetPicker, TYPE_ICON } from './asset-picker'
import { Modal } from './requirements-form'
import type { PackageItemInput } from '@/lib/services/packages'

type Ref = { type: string; id: string }
type Pkg = { id: string; name: string; description: string | null; readme: string | null; roots: Ref[]; items: Ref[]; excluded: Ref[]; data_modes: Record<string, string> }

const key = refKey
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
  // Synchronous guard: two clicks in one frame both see busy === false.
  const saveGuard = useSubmitGuard()
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
    await saveGuard.run(async () => {
      setBusy(true)
      setError(null)
      const input = { name, description: description || null, readme: readme || null, roots: roots as PackageItemInput[], items: items as PackageItemInput[], excluded: excluded as PackageItemInput[], data_modes: dataModes }
      const result = pkg ? await updatePackageAction(pkg.id, input) : await createPackageAction(input)
      setBusy(false)
      if (!result.ok) { setError(result.error); return }
      onOpenChange(false)
      onSaved(result.data.name)
    })
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
      size="xl"
      onEscapeKeyDown={(event) => { if (escapeRef.current?.()) event.preventDefault() }}
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button onClick={() => void save()} loading={busy} disabled={!name.trim() || !roots.length} data-testid="package-save">{pkg ? 'Save' : 'Create package'}</Button>
      </>}
    >
      {error && <InlineNotice tone="error" message={error} className="mb-4" />}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoice approval" data-testid="package-name" /></Field>
        <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Readme" optional description="Markdown, shown before install." className="sm:col-span-2">
          <Textarea rows={3} value={readme} onChange={(e) => setReadme(e.target.value)} />
        </Field>
      </div>

      <AssetPicker membership={membership} emptyPackage={!roots.length} onAdd={add} escapeRef={escapeRef} />
      {notice && <p className="mb-2 text-xs text-fg-muted" role="status">{notice}</p>}

      {roots.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-ui font-medium text-fg">In this package{previewItems.length ? <span className="num ml-1 font-normal text-fg-muted">{previewItems.length}</span> : null}</p>
            {showFilter && (
              <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="package-contents-filter">
                <SearchInput size="sm" wrapperClassName="w-44" value={filterText} onValueChange={setFilterText} placeholder="Filter items…" aria-label="Filter package items" data-testid="package-contents-search" />
                <Select size="sm" wrapperClassName="w-auto" value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Item type"
                  options={[{ value: '', label: 'All types' }, ...presentTypes.map(([type, label]) => ({ value: type, label }))]} />
                <Select size="sm" wrapperClassName="w-auto" value={filterShow} onChange={(e) => setFilterShow(e.target.value as 'all' | 'added' | 'dependency')} aria-label="Included as"
                  options={[{ value: 'all', label: 'Everything' }, { value: 'added', label: 'Added by you' }, { value: 'dependency', label: 'Dependencies' }]} />
              </div>
            )}
          </div>
          <div className="max-h-72 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border text-ui scrollbar-thin" data-testid="package-contents">
            {preview.isLoading && <p className="px-3 py-2 text-xs text-fg-muted" role="status">Resolving dependencies…</p>}
            {visible.map((item) => {
              const Icon = TYPE_ICON[item.type]
              return (
                <div key={key(item)} className="flex min-h-10 items-center gap-2 px-3 py-1">
                  {Icon && <Icon size={14} className="shrink-0 text-fg-muted" aria-hidden />}
                  <span className="w-28 shrink-0 text-xs text-fg-muted">{item.label}</span>
                  <span className="truncate text-fg">{item.name}</span>
                  <Badge tone={item.included_as === 'dependency' ? 'neutral' : 'brand'}>{item.included_as === 'dependency' ? 'Used by the package' : item.included_as === 'root' ? 'Root' : 'Added'}</Badge>
                  <div className="ml-auto flex items-center gap-1">
                    {item.type === 'data_table' && (
                      <Select size="sm" wrapperClassName="w-auto" value={dataModes[item.id] ?? 'schema'} onChange={(e) => setDataModes((m) => ({ ...m, [item.id]: e.target.value as 'schema' | 'rows' }))} aria-label={`${item.name} data`}
                        options={[{ value: 'schema', label: 'Schema only' }, { value: 'rows', label: `Schema + ${item.row_count ?? 0} rows` }]} />
                    )}
                    <IconButton size="sm" label={`Leave out ${item.name}`} icon={<X />} onClick={() => remove(item)} />
                  </div>
                </div>
              )
            })}
            {showFilter && !visible.length && <p className="px-3 py-2 text-xs text-fg-muted">No items match the filter.</p>}
            {excluded.map((ref) => (
              <div key={`x-${key(ref)}`} className="flex items-center gap-2 px-3 py-1.5 text-xs text-fg-muted">
                <span className="w-28 shrink-0">Left out</span>
                <span className="truncate">{excludedNames.get(key(ref)) ?? `${ref.type.replace(/_/g, ' ')} ${ref.id.slice(0, 8)}`}</span>
                <Button size="sm" variant="ghost" className="ml-auto" leadingIcon={<RotateCcw />} onClick={() => restore(ref)} aria-label={`Include ${excludedNames.get(key(ref)) ?? ref.id} again`}>Include</Button>
              </div>
            ))}
          </div>
          {showFilter && <p className="num mt-1 text-xs text-fg-muted" data-testid="package-contents-count">Showing {visible.length} of {previewItems.length}</p>}
        </>
      )}
      {(preview.data?.warnings ?? []).map((w) => <InlineNotice key={w} tone="warning" message={w} className="mt-2" />)}
      {(preview.data?.requirements ?? []).length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-ui font-medium text-fg">Asked for on install</p>
          <ul className="space-y-1 text-ui text-fg">
            {(preview.data?.requirements ?? []).map((r) => <li key={r.id} className="flex items-center gap-1.5"><KeyRound size={14} className="text-fg-muted" aria-hidden /> {r.label}{!r.required && <span className="text-xs text-fg-muted">(optional)</span>}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  )
}
