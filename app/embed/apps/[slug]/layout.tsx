import { Suspense, type ReactNode } from 'react'
import '@/components/home/home-grid.css'
import { AppShellRoute } from '@/components/apps/app-shell-route'
import { PermissionsProvider } from '@/lib/permissions-context'
import { embedViewer } from '@/lib/apps/embed-viewer-server'

/**
 * The embedded / full-screen app (/embed/apps/<slug>[/<page>]): for a signed-in
 * member the app's header, navigation and pages are drawn here, in the layout
 * Next keeps mounted across the app's pages, so moving between pages changes
 * only the content (as in the dashboard: app/(dashboard)/apps/[slug]/layout.tsx).
 * Everyone else gets the page's notices (signed out → sign in, not a member).
 * The app itself is shown only to its audience and editors, page by page
 * (lib/services/apps.ts, read on every navigation). ?menu=0 hides the app's menu.
 */
export default async function EmbeddedAppLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const [{ slug }, viewer] = await Promise.all([params, embedViewer()])
  if (viewer.kind !== 'member') return <>{children}</>
  const { getUserPermissions } = await import('@/lib/permissions-server')
  const permissions = [...(await getUserPermissions())]
  return (
    <PermissionsProvider permissions={permissions} userId={viewer.userId}>
      <Suspense>
        <AppShellRoute appSlug={slug} embed />
      </Suspense>
      {children}
    </PermissionsProvider>
  )
}
