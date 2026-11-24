import { Suspense, type ReactNode } from 'react'
import '@/components/home/home-grid.css'
import { AppShellRoute } from '@/components/apps/app-shell-route'

/**
 * An app inside the dashboard shell (/apps/<slug>[/<page>]): its header,
 * navigation and pages are drawn HERE, in the app's layout, which Next keeps
 * mounted while the person moves between the app's pages — the menu stays
 * static and only the page content changes (an application, not a site of
 * pages). The page segments below render nothing; the view reads the page
 * from the address. Every page is still read from the server on navigation
 * (apps.page: the app's audience, the page's lowest app role, published vs
 * draft — lib/services/apps.ts), so access is checked per page.
 * ?edit=1 opens the builder for the app's editors.
 */
export default async function AppLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return (
    <>
      <Suspense>
        <AppShellRoute appSlug={slug} />
      </Suspense>
      {children}
    </>
  )
}
