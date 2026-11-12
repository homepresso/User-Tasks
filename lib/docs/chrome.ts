/**
 * Server-side data for the docs chrome (app/docs/layout.tsx): the header tabs
 * with their sidebar sections, the header links per deployment mode and the
 * palette's suggestions. Plain data, handed to the client nav as props, so
 * the client bundle never imports the docs registry.
 */

import type { NavLinks, NavTab, SearchSuggestion } from '@/components/docs/docs-nav'
import { isCloud, publicCta } from '@/lib/deployment'
import { repositoryUrl } from '@/lib/site-links'
import { DOCS_TABS, START_HERE, sectionMeta, sectionsForTab } from './nav'
import { docHref, sectionOf } from './registry'

/** Header tabs with their sidebar sections (plain data for the client nav). */
export function docsNavTabs(): NavTab[] {
  return DOCS_TABS.map((tab) => ({
    ...tab,
    sections: sectionsForTab(tab.id).map((section) => ({
      title: section.title,
      icon: sectionMeta(section.title).icon,
      items: [
        ...section.pages.map((page) => ({ title: page.title, href: docHref(page.slug) })),
        ...(section.links ?? []),
      ],
    })),
  }))
}

/** Header links per deployment mode: no marketing pages when self-hosted (they 404 there). */
export function docsNavLinks(): NavLinks {
  const cloud = isCloud()
  return {
    brandHref: cloud ? '/' : '/docs',
    website: cloud ? '/' : null,
    repository: repositoryUrl(),
    contact: cloud ? '/contact' : null,
    signIn: publicCta(),
  }
}

/** The palette's empty-state picks: the docs home's "Start here" cards. */
export function docsSearchSuggestions(): SearchSuggestion[] {
  return START_HERE.map((item) => ({
    title: item.title,
    href: item.href,
    section: sectionOf(item.href.replace(/^\/docs\//, ''))?.title ?? 'Docs',
  }))
}
