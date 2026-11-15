import type { Metadata } from 'next'
import { WorkspaceThemeProvider } from '@/components/providers/theme-provider'
import { FontLinks } from '@/components/fonts/font-links'
import { loadSessionWorkspaceTheme } from '@/lib/theme/server'
import { themeFontHrefs, themeStylesheet } from '@/lib/theme/to-css'
import { APP_NAME, TITLE_TEMPLATE } from '@/lib/page-title'

/**
 * Trusted-embedding pages (/embed/…, lib/embedding.ts): the workspace theme
 * without the app shell, for a frame or dialog on a site the operator
 * approved (EMBED_FRAME_ANCESTORS). proxy.ts sets their frame-ancestors.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: { template: TITLE_TEMPLATE, default: APP_NAME }, robots: { index: false, follow: false } }

export default async function EmbedLayout({ children }: { children: React.ReactNode }) {
  const theme = await loadSessionWorkspaceTheme()
  return (
    <>
      <FontLinks hrefs={themeFontHrefs(theme)} />
      <style id="workspace-theme" dangerouslySetInnerHTML={{ __html: themeStylesheet(theme) }} />
      <WorkspaceThemeProvider theme={theme}>
        <div className="min-h-screen bg-background text-foreground">{children}</div>
      </WorkspaceThemeProvider>
    </>
  )
}
