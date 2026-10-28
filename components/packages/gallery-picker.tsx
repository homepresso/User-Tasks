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
import { Download, ExternalLink, Search, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import type { GalleryIndex, GalleryIndexEntry } from '@/lib/gallery/types'
import { GALLERY_CATEGORIES, GALLERY_NEEDS, GALLERY_ORIGINS, GALLERY_TRIGGERS, NATIVE_BADGE } from '@/lib/gallery/types'
import { Modal } from './requirements-form'

const muted = { color: 'var(--theme-muted-text)' }
/** The public gallery pages live on usertasks.com (self-hosted instances serve the files, not the marketing pages). */
const SITE = 'https://usertasks.com'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function GalleryPicker({ open, onOpenChange, onPick, installedUids }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (file: { name: string; base64: string }) => void
  installedUids: Set<string>
}) {
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
  const packages = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return (index.data?.index.packages ?? []).filter((p) => (category === 'all' || p.category === category)
      && (source === 'all' || (p.source ?? 'official') === source)
      && (!nativeOnly || p.native)
      && words.every((w) => `${p.title} ${p.summary} ${p.tags.join(' ')} ${(p.systems ?? []).join(' ')} ${p.author?.name ?? ''}`.toLowerCase().includes(w)))
  }, [index.data, query, category, source, nativeOnly])

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
    <Modal open={open} onOpenChange={onOpenChange} title="Package gallery" width="w-[min(56rem,94vw)]">
      <div className="space-y-4" data-testid="gallery-picker">
        <p className="text-sm" style={muted}>
          Ready-made processes from the UserTasks gallery: Official packages from the UserTasks team and Community packages shared by users and approved by a moderator. Choosing one opens the import wizard: the file is verified and you see every change before anything is installed.{' '}
          <a href={`${SITE}/gallery`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">Details on the website <ExternalLink size={12} /></a>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[14rem]">
            <span className="sr-only">Search the gallery</span>
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={muted} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search packages" className="w-full rounded-lg border pl-8 pr-3 py-1.5 text-sm bg-transparent" style={{ borderColor: 'var(--theme-surface-border)' }} />
          </label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="rounded-lg border px-2 py-1.5 text-sm bg-transparent" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <option value="all">All categories</option>
            {GALLERY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="Source" data-testid="gallery-source" className="rounded-lg border px-2 py-1.5 text-sm bg-transparent" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <option value="all">Official and Community</option>
            <option value="official">Official</option>
            <option value="community">Community</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={nativeOnly} onChange={(e) => setNativeOnly(e.target.checked)} data-testid="gallery-native" /> {NATIVE_BADGE.label}</label>
        </div>
        {index.data?.community_error && <InlineNotice tone="warning" message={`${index.data.community_error}. Showing the official packages.`} />}
        {index.data && (
          <p className="text-xs flex items-center gap-1.5" style={muted}>
            {index.data.index.signing.signed ? <><ShieldCheck size={13} /> Official packages signed by {index.data.index.signing.key_name} · {index.data.index.signing.fingerprint}</> : <><ShieldAlert size={13} /> Official packages: unsigned preview build — the wizard shows each file&apos;s checksum</>}
          </p>
        )}
        {index.isLoading && <p className="text-sm" style={muted}>Loading the gallery…</p>}
        {index.error && <InlineNotice tone="error" message={(index.error as Error).message} />}
        {error && <InlineNotice tone="error" message={error} />}
        <ul className="grid gap-2 sm:grid-cols-2">
          {packages.map((p) => (
            <li key={`${p.source ?? 'official'}-${p.slug}`} className="rounded-lg border p-3 flex flex-col gap-1.5" style={{ borderColor: 'var(--theme-surface-border)' }} data-testid={`gallery-item-${p.slug}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-sm">{p.title} <span className="font-normal text-xs" style={muted}>v{p.version}</span></p>
                <span className="text-[11px] whitespace-nowrap rounded-full px-2 py-0.5" style={{ backgroundColor: 'var(--theme-surface)' }}>{GALLERY_TRIGGERS[p.trigger]?.badge ?? p.trigger}</span>
              </div>
              <p className="flex flex-wrap gap-1 text-[11px]">
                <span className="rounded-full px-2 py-0.5 font-medium" title={GALLERY_ORIGINS[p.source ?? 'official'].description} data-testid={`gallery-origin-${p.source ?? 'official'}`} style={{ backgroundColor: p.source === 'community' ? 'rgba(107,78,142,0.14)' : 'var(--theme-surface)' }}>{GALLERY_ORIGINS[p.source ?? 'official'].label}</span>
                {p.native && <span className="rounded-full px-2 py-0.5 font-medium" title={NATIVE_BADGE.description} style={{ backgroundColor: 'rgba(79,122,91,0.14)' }}>{NATIVE_BADGE.label}</span>}
                {(p.systems ?? []).map((system) => <span key={system} className="rounded px-1.5 py-0.5 font-medium" style={{ backgroundColor: 'rgba(78,110,142,0.12)' }}>{system}</span>)}
              </p>
              <p className="text-xs leading-5" style={muted}>{p.summary}</p>
              <p className="text-[11px]" style={muted}>{p.source === 'community' ? `By ${p.author?.name ?? 'a community member'}${typeof p.downloads === 'number' ? ` · ${p.downloads} downloads` : ''} · ${p.licence ?? ''}` : `Needs: ${p.needs.map((n) => GALLERY_NEEDS[n]?.label ?? n).join(', ') || 'nothing'} · ~${p.setup_minutes} min setup`}</p>
              <div className="flex justify-end gap-2 mt-1">
                <a href={/^https?:\/\//.test(p.page) ? p.page : `${SITE}${p.page}`} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2 self-center" style={muted}>Details</a>
                <Button size="sm" variant={installedUids.has(p.id) ? 'outline' : 'default'} disabled={loading !== null} onClick={() => void pick(p)} data-testid={`gallery-install-${p.slug}`}>
                  <Download size={13} /> {loading === p.slug ? 'Loading…' : installedUids.has(p.id) ? 'Reinstall / upgrade' : 'Install'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {index.data && !packages.length && <p className="text-sm" style={muted}>No package matches.</p>}
      </div>
    </Modal>
  )
}
