import { assertCloudRoute } from '@/lib/deployment'
import '@/components/marketing/marketing-tokens.css'
import { RevealRoot } from '@/components/marketing/reveal-root'
import { publicBaseUrl } from '@/lib/deployment'
import { repositoryUrl } from '@/lib/site-links'
import { jsonLdHtml, PRODUCT_DEFINITION, siteGraph } from '@/lib/seo/site'

/**
 * Marketing route-group layout. globals.css themes the whole app via
 * *unlayered* rules — `[class*="bg-white"] { background: var(--theme-card-bg) }`
 * (line ~942) and `h1,h2,h3,h4 { color: var(--theme-card-text) }` (line ~1003)
 * — whose :root defaults are LIGHT. On these dark public pages that turns
 * translucent `bg-(color:--mkt-ink)/[N]` cards solid white and headings invisible.
 *
 * Reset every --theme-* variable to the dark marketing palette here (the same
 * values app/(auth)/layout.tsx and the landing page use) so every current and
 * future marketing page inherits the correct dark theme without repeating it.
 *
 * Marketing pages exist only on the cloud edition; self-hosted deployments 404.
 *
 * Every marketing page also carries the site-wide structured data
 * (Organization, WebSite, SoftwareApplication) that the pages' own JSON-LD
 * refers to by @id.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  assertCloudRoute()
  return (
    <div
      className="mkt"
      style={{
        '--theme-primary': 'var(--mkt-primary)',
        '--theme-primary-hover': 'var(--mkt-primary-hover)',
        '--theme-primary-light': 'rgba(23,21,15,0.14)',
        '--theme-card-bg': 'var(--mkt-white)',
        '--theme-card-text': 'var(--mkt-ink)',
        '--theme-surface': 'var(--mkt-canvas)',
        '--theme-surface-border': 'var(--mkt-line)',
        '--theme-muted-text': 'var(--mkt-muted)',
        '--theme-sidebar-bg': 'var(--mkt-paper)',
        '--theme-sidebar-text': 'var(--mkt-ink)',
        '--theme-topbar': 'var(--mkt-paper)',
        '--theme-topbar-text': 'var(--mkt-ink)',
        '--theme-accent': 'var(--mkt-primary)',
        '--theme-danger': 'var(--mkt-coral)',
        '--theme-success': 'var(--mkt-green-light)',
      } as React.CSSProperties}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(siteGraph(publicBaseUrl(), { description: PRODUCT_DEFINITION, repoUrl: repositoryUrl() })) }} />
      <RevealRoot />
      {children}
    </div>
  )
}
