import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { DocsSearch } from '@/components/docs/docs-search'
import { DocsSidebar, type SidebarSection } from '@/components/docs/docs-sidebar'
import { DOC_SECTIONS, docHref } from '@/lib/docs/registry'
import { isCloud, publicCta } from '@/lib/deployment'
import { Wordmark } from '@/components/brand/logo'

/**
 * Docs chrome: header with search, sidebar navigation, content. Served in both
 * deployment modes (self-hosters need the docs too); every page below is
 * statically generated.
 *
 * globals.css themes the app through --theme-* variables with light defaults;
 * reset the ones the docs rely on to the brand palette, as the marketing pages do.
 */
const THEME = {
  '--theme-primary': '#17150F',
  '--theme-primary-hover': '#2E2A24',
  '--theme-primary-light': 'rgba(23,21,15,0.14)',
  '--theme-card-bg': '#FFFFFF',
  '--theme-card-text': '#1B1916',
  '--theme-surface': '#F5F2EA',
  '--theme-surface-border': '#E6E1D5',
  '--theme-muted-text': '#6E6759',
  '--theme-accent': '#17150F',
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
    <div className="docs-abyss min-h-screen bg-[#FAF8F3] text-[#1B1916]" style={THEME}>
      <header className="sticky top-0 z-40 border-b border-[#1B1916]/[0.08] bg-[#FAF8F3]/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href={cloud ? '/' : '/docs'} aria-label="UserTasks home">
              <Wordmark size={30} />
            </Link>
            <Link href="/docs" className="rounded-md bg-[#17150F]/[0.06] px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-[#5C564C]">Docs</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <DocsSearch />
            <Link href="/docs/api-explorer" className="hidden text-sm text-[#5C564C] hover:text-[#1B1916] md:inline">API Explorer</Link>
            {cloud && <Link href="/contact" className="hidden text-sm text-[#5C564C] hover:text-[#1B1916] md:inline">Contact</Link>}
            <Link href={cta.href} className="rounded-lg bg-[#17150F] px-3 py-2 text-sm font-semibold text-[#FAF8F3] hover:bg-[#2E2A24] sm:px-4">{cta.label}</Link>
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
