import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { DocsSearch } from '@/components/docs/docs-search'
import { DocsSidebar, type SidebarSection } from '@/components/docs/docs-sidebar'
import { DOC_SECTIONS, docHref } from '@/lib/docs/registry'
import { isCloud, publicCta } from '@/lib/deployment'
import { Wordmark } from '@/components/brand/logo'
import '@/components/marketing/marketing-tokens.css'

/**
 * Docs chrome: header with search, sidebar navigation, content. Served in both
 * deployment modes (self-hosters need the docs too); every page below is
 * statically generated.
 *
 * globals.css themes the app through --theme-* variables with light defaults;
 * reset the ones the docs rely on to the brand palette, as the marketing pages do.
 */
const THEME = {
  '--theme-primary': 'var(--mkt-primary)',
  '--theme-primary-hover': 'var(--mkt-primary-hover)',
  '--theme-primary-light': 'rgba(23,21,15,0.14)',
  '--theme-card-bg': 'var(--mkt-white)',
  '--theme-card-text': 'var(--mkt-ink)',
  '--theme-surface': 'var(--mkt-canvas)',
  '--theme-surface-border': 'var(--mkt-line)',
  '--theme-muted-text': 'var(--mkt-muted)',
  '--theme-accent': 'var(--mkt-primary)',
} as CSSProperties

const SECTIONS: SidebarSection[] = DOC_SECTIONS.map((section) => ({
  title: section.title,
  items: [
    ...section.pages.map((page) => ({ title: page.title, href: docHref(page.slug) })),
    ...(section.links ?? []),
  ],
}))

export default function DocsLayout({ children }: { children: ReactNode }) {
  const cloud = isCloud()
  const cta = publicCta()
  return (
    <div className="mkt docs-abyss min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <header className="sticky top-0 z-40 border-b border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper)/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href={cloud ? '/' : '/docs'} aria-label="UserTasks home">
              <Wordmark size={30} />
            </Link>
            <Link href="/docs" className="rounded-md bg-(color:--mkt-primary)/[0.06] px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-muted-strong)">Docs</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <DocsSearch />
            <Link href="/docs/api-explorer" className="hidden text-sm text-(color:--mkt-muted-strong) hover:text-(color:--mkt-ink) md:inline">API Explorer</Link>
            {cloud && <Link href="/contact" className="hidden text-sm text-(color:--mkt-muted-strong) hover:text-(color:--mkt-ink) md:inline">Contact</Link>}
            <Link href={cta.href} className="rounded-lg bg-(color:--mkt-primary) px-3 py-2 text-sm font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover) sm:px-4">{cta.label}</Link>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1440px] gap-8 px-4 sm:px-6">
        <DocsSidebar sections={SECTIONS} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
