import { Suspense } from 'react'
import type { Metadata } from 'next'
import { DashboardAuthProvider } from '@/lib/dashboard-auth-context'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { WorkspaceThemeProvider } from '@/components/providers/theme-provider'
import { loadSessionWorkspaceTheme } from '@/lib/theme/server'
import { themeFontsHref, themeStylesheet } from '@/lib/theme/to-css'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { APP_NAME, TITLE_TEMPLATE } from '@/lib/page-title'
import { enforceHostWorkspace } from '@/lib/workspace-host'

export async function generateMetadata(): Promise<Metadata> {
  const theme = await loadSessionWorkspaceTheme()
  // Pages export `pageMetadata('Workflows')` (lib/page-title); client pages get
  // their tab title from the shell (route + PageHeader breadcrumbs).
  const title = { template: TITLE_TEMPLATE, default: APP_NAME }
  return theme.branding.favicon ? { title, icons: { icon: [{ url: resolveStorageUrl(theme.branding.favicon) }] } } : { title }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // On a workspace address (acme.usertasks.com): unknown → 404, signed out →
  // sign in, non-member → no access, another current workspace → switch
  // (lib/workspace-host.ts). Elsewhere a no-op.
  await enforceHostWorkspace()
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
