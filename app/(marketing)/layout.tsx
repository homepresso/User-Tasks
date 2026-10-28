import { assertCloudRoute } from '@/lib/deployment'

/**
 * Marketing route-group layout. globals.css themes the whole app via
 * *unlayered* rules — `[class*="bg-white"] { background: var(--theme-card-bg) }`
 * (line ~942) and `h1,h2,h3,h4 { color: var(--theme-card-text) }` (line ~1003)
 * — whose :root defaults are LIGHT. On these dark public pages that turns
 * translucent `bg-[#1B1916]/[N]` cards solid white and headings invisible.
 *
 * Reset every --theme-* variable to the dark marketing palette here (the same
 * values app/(auth)/layout.tsx and the landing page use) so every current and
 * future marketing page inherits the correct dark theme without repeating it.
 *
 * Marketing pages exist only on the cloud edition; self-hosted deployments 404.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  assertCloudRoute()
  return (
    <div
      style={{
        ['--theme-primary' as any]: '#17150F',
        ['--theme-primary-hover' as any]: '#2E2A24',
        ['--theme-primary-light' as any]: 'rgba(23,21,15,0.14)',
        ['--theme-card-bg' as any]: '#FFFFFF',
        ['--theme-card-text' as any]: '#1B1916',
        ['--theme-surface' as any]: '#F5F2EA',
        ['--theme-surface-border' as any]: '#E6E1D5',
        ['--theme-muted-text' as any]: '#6E6759',
        ['--theme-sidebar-bg' as any]: '#FAF8F3',
        ['--theme-sidebar-text' as any]: '#1B1916',
        ['--theme-topbar' as any]: '#FAF8F3',
        ['--theme-topbar-text' as any]: '#1B1916',
        ['--theme-accent' as any]: '#17150F',
        ['--theme-danger' as any]: '#D07A6A',
        ['--theme-success' as any]: '#7FA98A',
      }}
    >
      {children}
    </div>
  )
}
