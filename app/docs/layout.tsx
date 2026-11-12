import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { DocsHeader } from '@/components/docs/docs-header'
import { DocsNavProvider, DocsSidebar } from '@/components/docs/docs-nav'
import { docsNavLinks, docsNavTabs, docsSearchSuggestions } from '@/lib/docs/chrome'
import { LogoMark } from '@/components/brand/logo'
import { GitHubMark } from '@/components/docs/icons'
import '@/components/marketing/marketing-tokens.css'
import '@/components/docs/docs.css'

/**
 * Docs chrome: skip link, sticky header with area tabs and search, the
 * sidebar for the current area, content and a slim footer. Served in both
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

export default function DocsLayout({ children }: { children: ReactNode }) {
  const links = docsNavLinks()
  return (
    <div className="mkt docs-root docs-abyss min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <a href="#docs-main" className="sr-only z-[90] rounded-lg bg-(color:--mkt-primary) px-4 py-2 text-sm font-semibold text-(color:--mkt-paper) focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <DocsNavProvider tabs={docsNavTabs()} links={links} suggestions={docsSearchSuggestions()}>
        <DocsHeader links={links} />
        <div className="mx-auto flex max-w-[1440px] gap-6 px-4 sm:px-6 xl:gap-10">
          <DocsSidebar />
          <main id="docs-main" tabIndex={-1} className="min-w-0 flex-1 outline-none">{children}</main>
        </div>
      </DocsNavProvider>
      <footer className="border-t border-(color:--mkt-ink)/[0.08]">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-8 text-ui text-(color:--mkt-muted) sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <span>UserTasks documentation · Apache-2.0</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/docs" className="hover:text-(color:--mkt-ink)">Docs home</Link>
            <Link href="/docs/api-explorer" className="hover:text-(color:--mkt-ink)">API Explorer</Link>
            {links.website && <Link href={links.website} className="hover:text-(color:--mkt-ink)">Website</Link>}
            {links.contact && <Link href={links.contact} className="hover:text-(color:--mkt-ink)">Contact</Link>}
            {links.repository && (
              <a href={links.repository} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-(color:--mkt-ink)"><GitHubMark size={13} /> GitHub</a>
            )}
            <Link href={links.signIn.href} className="hover:text-(color:--mkt-ink)">{links.signIn.label}</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
