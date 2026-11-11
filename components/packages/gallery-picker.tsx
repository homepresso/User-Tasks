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
import { Badge, Tag } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tabs } from '@/components/ui/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { formatBytes } from '@/lib/format/number'
import type { GalleryIndex, GalleryIndexEntry } from '@/lib/gallery/types'
import { FORM_CONTROLS_CATEGORY, GALLERY_CATEGORIES, GALLERY_NEEDS, GALLERY_ORIGINS, GALLERY_TRIGGERS, NATIVE_BADGE } from '@/lib/gallery/types'
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

function tabOf(entry: GalleryIndexEntry): GalleryPickerTab {
  return isControl(entry) ? 'controls' : isAction(entry) ? 'actions' : 'packages'
}

const CAPABILITY_LABEL: Record<string, string> = { lookup: 'lookups', files: 'files', network: 'network', reports: 'reports' }

export type GalleryPickerTab = 'packages' | 'controls' | 'actions'

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
  const packages = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return (index.data?.index.packages ?? []).filter((p) => tabOf(p) === tab
      && (tab !== 'packages' || category === 'all' || p.category === category)
      && (source === 'all' || (p.source ?? 'official') === source)
      && (!nativeOnly || p.native)
      && words.every((w) => `${p.title} ${p.summary} ${p.tags.join(' ')} ${(p.systems ?? []).join(' ')} ${p.author?.name ?? ''} ${(p.control?.tags ?? []).join(' ')} ${(p.action?.operations ?? []).map((o) => `${o.id} ${o.label}`).join(' ')}`.toLowerCase().includes(w)))
  }, [index.data, query, category, source, nativeOnly, tab])

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

  const kindLabel = (p: GalleryIndexEntry) => isAction(p)
    ? `${p.action?.operations.length ?? 0} functions`
    : isControl(p) ? (p.kind === 'control_bundle' ? `${p.control?.tags.length ?? 0} controls` : p.control?.kind === 'display' ? 'Display control' : 'Input control')
    : (p.trigger ? GALLERY_TRIGGERS[p.trigger]?.badge ?? p.trigger : '')

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
        <ul className="grid gap-3 sm:grid-cols-2">
          {packages.map((p, index) => {
            const origin = p.source ?? 'official'
            const installed = installedUids.has(p.id)
            return (
              <li key={`${origin}-${p.slug}`} className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4 transition-colors duration-[var(--ds-dur-fast)] hover:border-border-strong" data-testid={`gallery-item-${p.slug}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg"><span className="truncate">{p.title}</span> <Tag mono>v{p.version}</Tag></p>
                  {kindLabel(p) && <Tag>{kindLabel(p)}</Tag>}
                </div>
                <p className="flex flex-wrap gap-1">
                  <Badge tone={origin === 'community' ? 'brand' : 'neutral'} title={GALLERY_ORIGINS[origin].description} data-testid={`gallery-origin-${origin}`}>{GALLERY_ORIGINS[origin].label}</Badge>
                  {p.native && <Badge tone="success" title={NATIVE_BADGE.description}>{NATIVE_BADGE.label}</Badge>}
                  {(p.systems ?? []).map((system) => <Tag key={system}>{system}</Tag>)}
                </p>
                <p className="line-clamp-2 text-ui text-fg-muted">{p.summary}</p>
                {isControl(p) && p.control && (
                  <p className="text-xs text-fg-muted" data-testid={`gallery-control-${p.slug}`}>
                    <span className="font-mono">{p.control.tags.map((t) => `<${t}>`).join(' ')}</span>
                    {' · '}value {p.control.value_types.join(' / ')}
                    {p.control.capabilities.length ? ` · uses ${p.control.capabilities.map((c) => CAPABILITY_LABEL[c] ?? c).join(', ')}` : ' · no host services'}
                    {p.control.hosts.length ? ` · network hosts to approve: ${p.control.hosts.join(', ')}` : ''}
                  </p>
                )}
                {isAction(p) && p.action && (
                  <p className="text-xs text-fg-muted" data-testid={`gallery-action-${p.slug}`}>
                    <span className="font-mono">{p.action.key}</span>
                    {' · '}{p.action.operations.slice(0, 6).map((o) => o.label).join(', ')}{p.action.operations.length > 6 ? '…' : ''}
                    {' · '}{p.action.capabilities.length ? `uses ${p.action.capabilities.join(', ')}${p.action.secrets.length ? ` (secrets: ${p.action.secrets.join(', ')})` : ''}` : 'pure computation'}
                  </p>
                )}
                <p className="num text-xs text-fg-muted">
                  {isAction(p)
                    ? `Sandboxed · includes a sample workflow · ${formatBytes(Math.max(1024, p.action?.module_bytes ?? 0))}`
                    : isControl(p)
                      ? `${p.requirement_count ? `Asks for ${p.requirement_count} setting${p.requirement_count === 1 ? '' : 's'} on install (e.g. an API key, stored on the server)` : 'Nothing to configure on install'} · ${formatBytes(p.control?.module_bytes ?? 0)}`
                      : p.source === 'community'
                        ? `By ${p.author?.name ?? 'a community member'}${typeof p.downloads === 'number' ? ` · ${p.downloads} downloads` : ''} · ${p.licence ?? ''}`
                        : `Needs: ${p.needs.map((n) => GALLERY_NEEDS[n]?.label ?? n).join(', ') || 'nothing'} · ~${p.setup_minutes} min setup`}
                </p>
                <div className="mt-auto flex items-center justify-end gap-2 pt-1">
                  <Button asChild size="sm" variant="ghost"><a href={/^https?:\/\//.test(p.page) ? p.page : `${SITE}${p.page}`} target="_blank" rel="noreferrer">Details</a></Button>
                  <Button size="sm" variant={installed ? 'secondary' : 'primary'} leadingIcon={<Download />} disabled={loading !== null} loading={loading === p.slug} onClick={() => void pick(p)} data-testid={`gallery-install-${p.slug}`} data-tour={index === 0 ? 'gallery-install' : undefined}>
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
