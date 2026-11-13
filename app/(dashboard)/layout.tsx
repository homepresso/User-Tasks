import { Suspense } from 'react'
import type { Metadata } from 'next'
import { DashboardAuthProvider } from '@/lib/dashboard-auth-context'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { WorkspaceThemeProvider } from '@/components/providers/theme-provider'
import { loadSessionWorkspaceTheme } from '@/lib/theme/server'
import { themeFontHrefs, themeStylesheet } from '@/lib/theme/to-css'
import { FontLinks } from '@/components/fonts/font-links'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { APP_NAME, TITLE_TEMPLATE } from '@/lib/page-title'
import { enforceHostWorkspace } from '@/lib/workspace-host'
import { redirectToSetupIfNeeded } from '@/lib/setup/server'
import { ExtensionsProvider } from '@/components/extensions/extensions-provider'
import { loadExtensionUiState } from '@/lib/extensions/ui-server'

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
  // Self-hosted with no workspaces and no users yet: /setup (cached; cloud never checks).
  await redirectToSetupIfNeeded()
  // The workspace theme is rendered on the server so the first paint (the
  // loading shell included) already has the right colours, fonts and sizes.
  const theme = await loadSessionWorkspaceTheme()
  const fontHrefs = themeFontHrefs(theme)
  // Extensions usable in this workspace (lib/extensions/ui-server): empty, with
  // no database call, in a build without extensions.
  const extensionUi = await loadExtensionUiState()
  return (
    <>
      {/* Theme web fonts, served from this origin (/fonts/g/…). */}
      <FontLinks hrefs={fontHrefs} />
      <style id="workspace-theme" dangerouslySetInnerHTML={{ __html: themeStylesheet(theme) }} />
      <WorkspaceThemeProvider theme={theme}>
        <DashboardAuthProvider>
          <ExtensionsProvider initial={extensionUi}>
            <Suspense fallback={null}>
              <DashboardShell>{children}</DashboardShell>
            </Suspense>
          </ExtensionsProvider>
        </DashboardAuthProvider>
      </WorkspaceThemeProvider>
    </>
  )
}
