/**
 * The public gallery's browse items, built from the catalog (lib/gallery/site).
 * Server-side: the pages hand the client browser these flat items (no
 * workflow graphs), so the catalog itself never reaches the client bundle.
 */

import type { GalleryChangelogEntry } from './types'
import type { BrowseItem } from './browse'
import { GALLERY_ACTIONS, GALLERY_CONTROLS, GALLERY_PACKAGES, type GalleryCard, type GalleryPackage } from './site'

function firstRelease(changelog: GalleryChangelogEntry[] | undefined, released: string): string {
  const dates = (changelog ?? []).map((c) => c.date).filter(Boolean).sort()
  return dates[0] ?? released
}

function lastUpdate(changelog: GalleryChangelogEntry[] | undefined, released: string): string {
  const dates = [released, ...(changelog ?? []).map((c) => c.date)].filter(Boolean).sort()
  return dates[dates.length - 1] ?? released
}

export function solutionItem(pkg: GalleryPackage): BrowseItem {
  return {
    key: `solution:official:${pkg.slug}`,
    kind: 'solution',
    slug: pkg.slug,
    href: `/gallery/${pkg.slug}`,
    title: pkg.title,
    summary: pkg.summary,
    tags: pkg.tags,
    category: pkg.category,
    source: 'official',
    native: pkg.native,
    systems: pkg.systems,
    trigger: pkg.trigger,
    version: pkg.version,
    firstReleased: firstRelease(pkg.changelog, pkg.released),
    updated: lastUpdate(pkg.changelog, pkg.released),
    signed: pkg.file.signed,
    facet: null,
    icon: pkg.icon ?? null,
    keywords: [...pkg.controls.map((c) => c.name), ...pkg.needs],
  }
}

/** Official solutions, form controls and workflow actions, in catalogue order. */
export function officialBrowseItems(): BrowseItem[] {
  return [
    ...GALLERY_PACKAGES.map(solutionItem),
    ...GALLERY_CONTROLS.map((c): BrowseItem => ({
      key: `control:official:${c.slug}`,
      kind: 'control',
      slug: c.slug,
      href: `/gallery/controls/${c.slug}`,
      title: c.title,
      summary: c.summary,
      tags: c.tags,
      category: 'form-controls',
      source: 'official',
      native: false,
      systems: c.systems,
      trigger: null,
      version: c.version,
      firstReleased: firstRelease(c.changelog, c.released),
      updated: lastUpdate(c.changelog, c.released),
      signed: c.file.signed,
      icon: c.icon,
      facet: c.kind === 'control_bundle' ? 'Bundle' : c.control_kind === 'display' ? 'Display' : 'Input',
      keywords: c.controls.flatMap((x) => [x.tag, x.name, ...x.capabilities]),
    })),
    ...GALLERY_ACTIONS.map((a): BrowseItem => ({
      key: `action:official:${a.slug}`,
      kind: 'action',
      slug: a.slug,
      href: `/gallery/actions/${a.slug}`,
      title: a.title,
      summary: a.summary,
      tags: a.tags,
      category: 'workflow-actions',
      source: 'official',
      native: false,
      systems: [],
      trigger: null,
      version: a.version,
      firstReleased: firstRelease(a.changelog, a.released),
      updated: lastUpdate(a.changelog, a.released),
      signed: a.file.signed,
      facet: null,
      icon: a.icon,
      keywords: [a.key, a.name, ...a.operations.flatMap((o) => [o.id, o.label])],
    })),
  ]
}

/** A listed community package (already a GalleryCard) as a browse item. */
export function communityBrowseItem(card: GalleryCard): BrowseItem {
  return {
    key: `solution:community:${card.slug}`,
    kind: 'solution',
    slug: card.slug,
    href: card.href ?? `/gallery/community/${card.slug}`,
    title: card.title,
    summary: card.summary,
    tags: card.tags,
    category: card.category,
    source: 'community',
    native: card.native === true,
    systems: card.systems ?? [],
    trigger: card.trigger,
    version: card.version,
    firstReleased: null,
    updated: null,
    signed: false,
    facet: null,
    keywords: [],
    author: card.author ?? null,
    downloads: card.downloads,
  }
}
