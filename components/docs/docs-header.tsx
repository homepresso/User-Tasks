import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { LogoMark } from '@/components/brand/logo'
import { DocsMenuButton, DocsSearchTrigger, DocsTabs, ThemeToggle, type NavLinks } from './docs-nav'
import { GitHubMark } from './icons'

/**
 * Sticky, slim docs header: brand mark + "Docs", the area tabs, search with
 * its ⌘K hint, the theme toggle, GitHub (only when a repository is
 * configured), the website (cloud only: marketing pages 404 when
 * self-hosted) and sign-in.
 */
export function DocsHeader({ links }: { links: NavLinks }) {
  return (
    <header className="sticky top-0 z-50 border-b border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper)/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-(--docs-header-h) max-w-[1440px] items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <DocsMenuButton />
        <div className="flex shrink-0 items-center gap-2.5">
          <Link href={links.brandHref} aria-label={links.website ? 'UserTasks website' : 'UserTasks documentation home'} className="flex items-center gap-2 rounded-lg">
            <LogoMark size={28} />
            <span className="hidden text-[1.05rem] font-semibold tracking-tight text-(color:--mkt-ink) sm:inline">usertasks</span>
          </Link>
          <span aria-hidden="true" className="hidden h-5 w-px bg-(color:--mkt-ink)/[0.14] sm:block" />
          <Link href="/docs" className="rounded-md font-display text-[1.05rem] font-semibold text-(color:--mkt-bronze) transition-colors hover:text-(color:--mkt-ink)">Docs</Link>
        </div>
        <div className="ml-4 hidden h-full lg:block">
          <DocsTabs />
        </div>
        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <div className="hidden w-[15rem] md:block"><DocsSearchTrigger /></div>
          <div className="md:hidden"><DocsSearchTrigger variant="icon" /></div>
          <ThemeToggle />
          {links.repository && (
            <a href={links.repository} target="_blank" rel="noopener noreferrer" aria-label="UserTasks on GitHub" className="hidden h-9 w-9 items-center justify-center rounded-lg text-(color:--mkt-muted-strong) transition hover:bg-(color:--mkt-ink)/[0.05] hover:text-(color:--mkt-ink) sm:inline-flex">
              <GitHubMark size={17} />
            </a>
          )}
          {links.website && (
            <Link href={links.website} className="hidden items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-ui font-medium text-(color:--mkt-muted-strong) transition hover:text-(color:--mkt-ink) xl:inline-flex">
              Website <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          )}
          <Link href={links.signIn.href} className="mkt-btn-primary ml-1 hidden rounded-lg px-3.5 py-1.5 text-ui font-semibold sm:inline-flex">{links.signIn.label}</Link>
        </div>
      </div>
    </header>
  )
}
