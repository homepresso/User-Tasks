'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { MobileNavSheet, MobileTabBar } from './mobile-nav'
import { GlobalSearch } from './global-search'
import { ShellDocumentTitle } from './document-title'
import { PermissionsProvider } from '@/lib/permissions-context'
import { BreadcrumbsProvider } from '@/lib/breadcrumbs-context'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { canAccessPath } from '@/lib/route-permissions'
import { LastSeenHeartbeat } from './last-seen-heartbeat'
import { LicenceBanner } from './licence-banner'
import { NotAuthorizedView } from './route-states'
import { LogoMark } from '@/components/brand/logo'
import { Skeleton } from '@/components/ui/skeleton'
import { BusyBar } from '@/components/ui/busy-bar'
import { JobsProvider } from '@/components/jobs/jobs-provider'
import { AssistantHost } from '@/components/assistants/assistant-host'
import { OnboardingProvider } from '@/components/onboarding/getting-started/onboarding-provider'
import { ExtensionActionHost } from '@/components/extensions/action-host'

/**
 * The dashboard frame (docs/design/ui-polish-spec.md §4.4): sidebar, top bar
 * and the scrolling main area, plus the ⌘K palette, the tab title and the
 * mobile Sheet nav / tab bar. Pages own their width (lists full width,
 * settings 1080px, detail 960px).
 *
 * Only #main scrolls. The frame is the dynamic viewport tall (h-dvh: on iOS
 * Safari 100vh is the toolbar-hidden height, which let the whole page scroll
 * under the toolbar), and #main is `relative` so absolutely positioned bits
 * inside it (sr-only labels) are clipped by it. Without that they escaped
 * to the document, made the page itself scroll and dragged the frame up,
 * cutting off the end of #main above the tab bar.
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { loading, profile, userRole, permissions, userId } = useDashboardAuth()
  const pathname = usePathname()
  const [hasHydrated, setHasHydrated] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const routeAllowed = profile && userId ? canAccessPath(pathname, permissions) : true

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first client render matches the server's loading shell
    setHasHydrated(true)
  }, [])

  // Only show the full skeleton on very first load (no cached profile at all).
  // Once we have a profile (even from cache), keep the shell visible during
  // background auth re-verification so navigation feels instant.
  if (!hasHydrated || (loading && !profile)) return <DashboardLoadingShell />

  // If auth dropped entirely (signed out) — redirect handled by auth context
  if (!profile || !userId) return null

  return (
    <PermissionsProvider permissions={permissions} userId={userId}>
      <BreadcrumbsProvider resetKey={pathname}>
        <LastSeenHeartbeat userId={userId} />
        <ShellDocumentTitle />
        <JobsProvider>
          <OnboardingProvider userId={userId}>
          <div className="flex h-dvh overflow-hidden">
            <Sidebar user={profile} currentTenantId={profile.current_tenant_id} userRole={userRole} />
            <MobileNavSheet
              open={mobileNavOpen}
              onOpenChange={setMobileNavOpen}
              user={profile}
              currentTenantId={profile.current_tenant_id}
            />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Topbar user={profile} currentTenantId={profile.current_tenant_id} onMenuClick={() => setMobileNavOpen(true)} />
              {/* Licence expiry / invalid licence: instance admins only (empty for everyone else). */}
              <LicenceBanner />
              <main
                key={pathname}
                id="main"
                className="page-transition relative flex-1 overflow-y-auto bg-bg p-4 max-md:pb-[calc(var(--ds-tabbar-h)+1.5rem+env(safe-area-inset-bottom))] md:p-6"
              >
                {/* A page the role doesn't allow: "Not authorized" in place of the page (nothing of it mounts). */}
                {routeAllowed ? children : <NotAuthorizedView />}
              </main>
              <MobileTabBar />
            </div>
            {/* The Agent: one floating button and a docked panel that pushes the page (only when available to this person). It lives in the shell, so its conversation follows navigation. */}
            <AssistantHost />
          </div>
          <GlobalSearch />
          {/* Runs actions contributed by extensions (row menus, bulk bars). */}
          <ExtensionActionHost />
          </OnboardingProvider>
        </JobsProvider>
      </BreadcrumbsProvider>
    </PermissionsProvider>
  )
}

/** First-load frame: the sidebar and top bar outlines, a busy bar and shimmering rows (no spinner). */
function DashboardLoadingShell() {
  return (
    <div className="flex h-dvh overflow-hidden" aria-busy="true" aria-label="Loading your workspace">
      <aside className="premium-sidebar themed-sidebar flex w-[var(--theme-sidebar-width)] shrink-0 flex-col border-r border-[color:var(--theme-sidebar-border)] max-md:hidden">
        <div className="flex h-[var(--theme-topbar-height)] items-center gap-2 border-b border-[color:var(--theme-sidebar-border)] px-4">
          <LogoMark variant="glyph" size={22} color="var(--theme-sidebar-text)" accent="var(--theme-sidebar-accent, var(--theme-primary))" />
          <span className="h-2.5 w-24 rounded-sm bg-[color-mix(in_srgb,var(--theme-sidebar-text)_12%,transparent)]" />
        </div>
        <div className="flex-1 space-y-1 p-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="flex h-8 items-center gap-2 px-2">
              <span className="size-4 rounded-sm bg-[color-mix(in_srgb,var(--theme-sidebar-text)_10%,transparent)]" />
              <span className="h-2.5 rounded-sm bg-[color-mix(in_srgb,var(--theme-sidebar-text)_10%,transparent)]" style={{ width: `${45 + (i * 7) % 35}%` }} />
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="themed-topbar relative flex h-[var(--theme-topbar-height)] shrink-0 items-center justify-between border-b border-border-subtle px-6">
          <Skeleton className="h-3 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-[280px] max-lg:hidden" />
            <Skeleton className="size-7 rounded-full" />
          </div>
          <BusyBar className="absolute inset-x-0 bottom-0" />
        </div>
        <main className="flex-1 bg-bg p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-3 w-80" />
          <div className="mt-8 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
          <p className="sr-only" role="status">Loading your workspace…</p>
        </main>
      </div>
    </div>
  )
}
