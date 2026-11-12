'use client'

/**
 * "Browse gallery" on the Packages page: Official packages (public/gallery,
 * shipped with every instance) and Community packages — this instance's own
 * on usertasks.com, else the public gallery index (GALLERY_INDEX_URL),
 * fetched and downloaded through this instance's server
 * (/api/internal/gallery/*), so the browser only talks to its own origin.
 * The chosen .utpkg goes to the import wizard, which verifies it like any
 * other file.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tabs } from '@/components/ui/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { formatBytes } from '@/lib/format/number'
import type { GalleryIndex, GalleryIndexEntry } from '@/lib/gallery/types'
import { FORM_CONTROLS_CATEGORY, GALLERY_CATEGORIES, GALLERY_NEEDS, GALLERY_ORIGINS, NATIVE_BADGE } from '@/lib/gallery/types'
import { browse, BROWSE_SORTS, DEFAULT_BROWSE_STATE, indexEntryToBrowseItem, isNew, newestRelease, type BrowseKind, type BrowseSort } from '@/lib/gallery/browse'
import { appCardFrame, CardBody } from '@/components/gallery/gallery-card'
import { categoryIcon } from '@/components/gallery/gallery-icons'
import { Modal } from './requirements-form'

/** The public gallery pages live on usertasks.com (self-hosted instances serve the files, not the marketing pages). */
const SITE = 'https://usertasks.com'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** A form control entry (official gallery/controls) rather than a workflow package. */
function isControl(entry: GalleryIndexEntry): boolean {
  return entry.kind === 'form_control' || entry.kind === 'control_bundle'
}

/** A custom workflow action entry (official gallery/actions). */
function isAction(entry: GalleryIndexEntry): boolean {
  return entry.kind === 'workflow_action'
}

const CAPABILITY_LABEL: Record<string, string> = { lookup: 'lookups', files: 'files', network: 'network', reports: 'reports' }

export type GalleryPickerTab = 'packages' | 'controls' | 'actions'

const TAB_KIND: Record<GalleryPickerTab, BrowseKind> = { packages: 'solution', controls: 'control', actions: 'action' }

export function GalleryPicker({ open, onOpenChange, onPick, installedUids, initialTab = 'packages' }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (file: { name: string; base64: string }) => void
  installedUids: Set<string>
  /** Open on the Form controls tab (Extensibility → Form controls → Browse gallery). */
  initialTab?: GalleryPickerTab
}) {
  const [tab, setTab] = useState<GalleryPickerTab>(initialTab)
  const [openedWith, setOpenedWith] = useState<{ open: boolean; tab: GalleryPickerTab }>({ open, tab: initialTab })
  if (openedWith.open !== open || openedWith.tab !== initialTab) {
    // Reopening (or reopening from another entry point) starts on the requested tab.
    setOpenedWith({ open, tab: initialTab })
    if (open) setTab(initialTab)
  }
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [source, setSource] = useState<'all' | 'official' | 'community'>('all')
  const [nativeOnly, setNativeOnly] = useState(false)
  const [sort, setSort] = useState<BrowseSort>('featured')
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const index = useQuery({
    queryKey: ['package-gallery-index'],
    queryFn: async () => {
      const res = await fetch('/api/internal/gallery/index', { cache: 'no-store' })
      if (!res.ok) {
        // Older servers: the official index only.
        const fallback = await fetch('/gallery/index.json', { cache: 'no-store' })
        if (!fallback.ok) throw new Error(`The gallery is not available on this instance (HTTP ${res.status})`)
        return { index: (await fallback.json()) as GalleryIndex, community_source: null, community_error: null }
      }
      return (await res.json()) as { index: GalleryIndex; community_source: string | null; community_error: string | null }
    },
    enabled: open,
    staleTime: 300_000,
  })
  const all = index.data?.index.packages ?? []
  const controlCount = all.filter(isControl).length
  const actionCount = all.filter(isAction).length
  // The shared gallery search, filters and sort (lib/gallery/browse), over this instance's index entries.
  const entries = useMemo(() => {
    const list = index.data?.index.packages ?? []
    return { items: list.map(indexEntryToBrowseItem), byKey: new Map(list.map((e) => [indexEntryToBrowseItem(e).key, e])) }
  }, [index.data])
  const reference = useMemo(() => newestRelease(entries.items.filter((i) => i.source === 'official')), [entries])
  const packages = useMemo(() => browse(entries.items, {
    ...DEFAULT_BROWSE_STATE,
    q: query,
    kind: TAB_KIND[tab],
    category: tab === 'packages' ? category : 'all',
    source,
    native: nativeOnly,
    sort,
  }).map((item) => ({ item, entry: entries.byKey.get(item.key)! })), [entries, query, category, source, nativeOnly, tab, sort])

  const pick = async (entry: GalleryIndexEntry) => {
    setError(null)
    setLoading(entry.slug)
    try {
      // Remote community packages come through this server; everything else is same-origin.
      const remote = /^https?:\/\//.test(entry.file) && !entry.file.startsWith(window.location.origin)
      const res = await fetch(remote ? `/api/internal/gallery/package?slug=${encodeURIComponent(entry.slug)}` : entry.file, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
      onPick({ name: entry.file_name, base64: bytesToBase64(new Uint8Array(await res.arrayBuffer())) })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setLoading(null)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Package gallery" size="xl"
      description={<>Ready-made processes from the UserTasks gallery: Official packages from the UserTasks team and Community packages shared by users and approved by a moderator. Choosing one opens the import wizard: the file is verified and you see every change before anything is installed.{' '}
        <a href={`${SITE}/gallery`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-text underline underline-offset-2">Details on the website <ExternalLink size={12} aria-hidden /></a></>}>
      <div className="space-y-4" data-testid="gallery-picker">
        <Tabs aria-label="What to install" value={tab} onValueChange={setTab}
          items={[
            { value: 'packages', label: 'Workflow packages', count: all.length - controlCount - actionCount },
            { value: 'controls', label: 'Form controls', count: controlCount },
            { value: 'actions', label: 'Workflow actions', count: actionCount },
          ]} />
        {tab === 'controls' && (
          <p className="text-xs text-fg-muted">
            Official web components for your forms. Installing one adds it to <strong className="font-medium text-fg">Extensibility → Form controls</strong> and the form designer&apos;s <strong className="font-medium text-fg">Custom</strong> palette. Each runs in a sandboxed frame; a control that needs network access stays offline until an admin approves its hosts there.
          </p>
        )}
        {tab === 'actions' && (
          <p className="text-xs text-fg-muted">
            Official custom workflow steps. Installing one adds it to <strong className="font-medium text-fg">Extensibility → Workflow actions</strong> and the workflow designer&apos;s <strong className="font-medium text-fg">Custom actions</strong> palette. Each runs in a WebAssembly sandbox; an action that needs secrets, hosts or tables asks an admin to approve them there.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput wrapperClassName="min-w-[14rem] flex-1" value={query} onValueChange={setQuery} aria-label="Search the gallery"
            placeholder={tab === 'controls' ? 'Search controls: chart, address, signature…' : tab === 'actions' ? 'Search actions: loan, business days, slugify…' : 'Search packages'} />
          {tab === 'packages' && (
            <Select wrapperClassName="w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"
              options={[{ value: 'all', label: 'All categories' }, ...GALLERY_CATEGORIES.filter((c) => c.id !== FORM_CONTROLS_CATEGORY && c.id !== 'workflow-actions').map((c) => ({ value: c.id, label: c.title }))]} />
          )}
          <Select wrapperClassName="w-auto" value={sort} onChange={(e) => setSort(e.target.value as BrowseSort)} aria-label="Sort" data-testid="gallery-sort"
            options={(Object.keys(BROWSE_SORTS) as BrowseSort[]).filter((key) => key !== 'updated').map((key) => ({ value: key, label: BROWSE_SORTS[key] }))} />
          <span data-testid="gallery-source">
            <SegmentedControl aria-label="Source" value={source} onValueChange={setSource}
              options={[{ value: 'all', text: 'All' }, { value: 'official', text: 'Official' }, { value: 'community', text: 'Community' }]} />
          </span>
          <Checkbox checked={nativeOnly} onChange={(e) => setNativeOnly(e.target.checked)} data-testid="gallery-native" label={NATIVE_BADGE.label} />
        </div>
        {index.data?.community_error && <InlineNotice tone="warning" message={`${index.data.community_error}. Showing the official packages.`} />}
        {index.data && (
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            {index.data.index.signing.signed
              ? <><ShieldCheck size={14} className="text-success" aria-hidden /> Official packages signed by {index.data.index.signing.key_name} · <span className="font-mono">{index.data.index.signing.fingerprint}</span></>
              : <><ShieldAlert size={14} className="text-warning" aria-hidden /> Official packages: unsigned preview build — the wizard shows each file&apos;s checksum</>}
          </p>
        )}
        {index.isLoading && <p className="text-ui text-fg-muted" role="status">Loading the gallery…</p>}
        {index.error && <InlineNotice tone="error" message={(index.error as Error).message} />}
        {error && <InlineNotice tone="error" message={error} />}
        {index.data && packages.length > 0 && (
          <p className="num text-xs text-fg-muted" aria-live="polite" data-testid="gallery-count">{packages.length} {packages.length === 1 ? 'result' : 'results'}</p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {packages.map(({ item, entry: p }, index) => {
            const origin = p.source ?? 'official'
            const installed = installedUids.has(p.id)
            const Icon = categoryIcon(p.category)
            return (
              <li key={item.key} className={appCardFrame} data-testid={`gallery-item-${p.slug}`} data-origin={origin}>
                <span className="sr-only" data-testid={`gallery-origin-${origin}`}>{GALLERY_ORIGINS[origin].label}</span>
                <CardBody item={item} tone="app" isNew={isNew(item, reference)} icon={<Icon size={20} aria-hidden />} maxTags={3} />
                {isControl(p) && p.control && (
                  <p className="mt-2 text-xs text-fg-muted" data-testid={`gallery-control-${p.slug}`}>
                    <span className="font-mono">{p.control.tags.map((t) => `<${t}>`).join(' ')}</span>
                    {' · '}value {p.control.value_types.join(' / ')}
                    {p.control.capabilities.length ? ` · uses ${p.control.capabilities.map((c) => CAPABILITY_LABEL[c] ?? c).join(', ')}` : ' · no host services'}
                    {p.control.hosts.length ? ` · network hosts to approve: ${p.control.hosts.join(', ')}` : ''}
                  </p>
                )}
                {isAction(p) && p.action && (
                  <p className="mt-2 text-xs text-fg-muted" data-testid={`gallery-action-${p.slug}`}>
                    <span className="font-mono">{p.action.key}</span>
                    {' · '}{p.action.operations.slice(0, 6).map((o) => o.label).join(', ')}{p.action.operations.length > 6 ? '…' : ''}
                    {' · '}{p.action.capabilities.length ? `uses ${p.action.capabilities.join(', ')}${p.action.secrets.length ? ` (secrets: ${p.action.secrets.join(', ')})` : ''}` : 'pure computation'}
                  </p>
                )}
                <p className="num mt-2 text-xs text-fg-muted">
                  {isAction(p)
                    ? `Sandboxed · includes a sample workflow · ${formatBytes(Math.max(1024, p.action?.module_bytes ?? 0))}`
                    : isControl(p)
                      ? `${p.requirement_count ? `Asks for ${p.requirement_count} setting${p.requirement_count === 1 ? '' : 's'} on install (e.g. an API key, stored on the server)` : 'Nothing to configure on install'} · ${formatBytes(p.control?.module_bytes ?? 0)}`
                      : p.source === 'community'
                        ? `${p.licence ?? ''}`
                        : `Needs: ${p.needs.map((n) => GALLERY_NEEDS[n]?.label ?? n).join(', ') || 'nothing'} · ~${p.setup_minutes} min setup`}
                </p>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button asChild size="sm" variant="ghost"><a href={/^https?:\/\//.test(p.page) ? p.page : `${SITE}${p.page}`} target="_blank" rel="noreferrer" aria-label={`Details of ${p.title} on the website`}>Details <ExternalLink size={12} aria-hidden /></a></Button>
                  <Button size="sm" variant={installed ? 'secondary' : 'primary'} leadingIcon={<Download />} disabled={loading !== null} loading={loading === p.slug} onClick={() => void pick(p)} data-testid={`gallery-install-${p.slug}`} data-tour={index === 0 ? 'gallery-install' : undefined} aria-label={`${installed ? 'Reinstall or upgrade' : 'Install'} ${p.title}`}>
                    {installed ? 'Reinstall / upgrade' : 'Install'}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        {index.data && !packages.length && (
          <EmptyState size="sm" variant={query || category !== 'all' || source !== 'all' || nativeOnly ? 'no-results' : 'first-run'}
            title={tab === 'controls' && !controlCount ? 'This instance ships no form controls in its gallery yet' : tab === 'actions' && !actionCount ? 'This instance ships no workflow actions in its gallery yet' : 'No package matches'} />
        )}
      </div>
    </Modal>
  )
}
