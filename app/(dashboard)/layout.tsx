import { Suspense } from 'react'
import type { Metadata } from 'next'
import { DashboardAuthProvider } from '@/lib/dashboard-auth-context'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { WorkspaceThemeProvider } from '@/components/providers/theme-provider'
import { loadSessionWorkspaceTheme } from '@/lib/theme/server'
import { themeFontsHref, themeStylesheet } from '@/lib/theme/to-css'
import { resolveStorageUrl } from '@/lib/storage/refs'

export async function generateMetadata(): Promise<Metadata> {
  const theme = await loadSessionWorkspaceTheme()
  return theme.branding.favicon ? { icons: { icon: [{ url: resolveStorageUrl(theme.branding.favicon) }] } } : {}
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The workspace theme is rendered on the server so the first paint (the
  // loading shell included) already has the right colours, fonts and sizes.
  const theme = await loadSessionWorkspaceTheme()
  const fontsHref = themeFontsHref(theme)
  return (
    <>
      {fontsHref && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          {/* No `precedence`: a slow or blocked fonts host must not hold up rendering. */}
          <link rel="stylesheet" href={fontsHref} />
        </>
      )}
      <style id="workspace-theme" dangerouslySetInnerHTML={{ __html: themeStylesheet(theme) }} />
      <WorkspaceThemeProvider theme={theme}>
        <DashboardAuthProvider>
          <Suspense fallback={null}>
            <DashboardShell>{children}</DashboardShell>
          </Suspense>
        </DashboardAuthProvider>
      </WorkspaceThemeProvider>
    </>
  )
}
