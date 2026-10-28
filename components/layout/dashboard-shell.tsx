'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { MobileNavDrawer, MobileTabBar } from './mobile-nav'
import { PermissionsProvider } from '@/lib/permissions-context'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { canAccessPath } from '@/lib/route-permissions'
import { LastSeenHeartbeat } from './last-seen-heartbeat'
import { LogoMark } from '@/components/brand/logo'
import { JobsProvider } from '@/components/jobs/jobs-provider'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { loading, profile, userRole, permissions, userId } = useDashboardAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [hasHydrated, setHasHydrated] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const routeAllowed = profile && userId ? canAccessPath(pathname, permissions) : true

  useEffect(() => {
    setHasHydrated(true)
  }, [])

  useEffect(() => {
    if (!loading && profile && userId && !routeAllowed) {
      // /tasks is the landing page; fall back to the ungated settings page for
      // roles without task access so the redirect can't loop.
      router.replace(canAccessPath('/tasks', permissions) ? '/tasks' : '/settings')
    }
  }, [loading, profile, userId, routeAllowed, router, permissions])

  // Only show the full skeleton on very first load (no cached profile at all).
  // Once we have a profile (even from cache), keep the shell visible during
  // background auth re-verification so navigation feels instant.
  if (!hasHydrated || (loading && !profile)) return <DashboardLoadingShell />

  // If auth dropped entirely (signed out) — redirect handled by auth context
  if (!profile || !userId) return null

  if (!routeAllowed) return null

  return (
    <PermissionsProvider permissions={permissions} userId={userId}>
      <LastSeenHeartbeat userId={userId} />
      <JobsProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar user={profile} currentTenantId={profile.current_tenant_id} userRole={userRole} />
        <MobileNavDrawer
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          branding={profile.tenant?.branding ?? null}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar user={profile} onMenuClick={() => setMobileNavOpen(true)} />
          <main
            key={pathname}
            className="flex-1 overflow-y-auto page-transition max-md:pb-20 p-3 md:p-6"
            style={{ backgroundColor: 'var(--theme-surface)' }}
          >
            {children}
          </main>
          <MobileTabBar />
        </div>
      </div>
      </JobsProvider>
    </PermissionsProvider>
  )
}

function DashboardLoadingShell() {
  return (
    <div className="flex h-screen overflow-hidden" style={{ animation: 'shell-enter 0.4s ease-out' }}>
      {/* Branded sidebar skeleton — the workspace theme's server-rendered vars */}
      <aside className="premium-sidebar w-[var(--theme-sidebar-width)] border-r flex flex-col max-md:hidden" style={{ backgroundColor: 'var(--theme-sidebar)' }}>
        <div className="h-[var(--theme-topbar-height)] flex items-center px-4 border-b" style={{ borderColor: 'var(--theme-sidebar-border)' }}>
          <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
            <LogoMark variant="glyph" size={24} color="var(--theme-sidebar-text)" accent="var(--theme-sidebar-accent)" />
            <span>
              <span style={{ color: 'var(--theme-sidebar-text)' }}>user</span>
              <span style={{ color: 'var(--theme-sidebar-accent)' }}>tasks</span>
            </span>
          </span>
        </div>
        <div className="flex-1 p-3 space-y-1.5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="h-9 rounded-lg flex items-center gap-3 px-3" style={{
              backgroundColor: i === 1 ? 'var(--theme-sidebar-active)' : 'transparent',
              animation: `shell-fade-in 0.3s ease-out ${0.1 + i * 0.04}s both`,
            }}>
              <div className="w-4 h-4 rounded" style={{ backgroundColor: i === 1 ? 'var(--theme-primary)' : 'color-mix(in srgb, var(--theme-sidebar-text) 8%, transparent)', opacity: i === 1 ? 0.4 : 1 }} />
              <div className="h-2.5 rounded" style={{ width: `${50 + (i * 7) % 40}%`, backgroundColor: i === 1 ? 'var(--theme-primary)' : 'color-mix(in srgb, var(--theme-sidebar-text) 8%, transparent)', opacity: i === 1 ? 0.3 : 1 }} />
            </div>
          ))}
        </div>
      </aside>

      {/* Main area with progress indicator */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="h-[var(--theme-topbar-height)] border-b flex items-center justify-between px-6" style={{ backgroundColor: 'var(--theme-topbar)', borderColor: 'var(--theme-surface-border)' }}>
          <div className="space-y-1.5" style={{ animation: 'shell-fade-in 0.3s ease-out 0.2s both' }}>
            <div className="h-3.5 w-28 rounded" style={{ backgroundColor: 'var(--theme-surface-border)' }} />
            <div className="h-2.5 w-16 rounded" style={{ backgroundColor: 'var(--theme-surface)' }} />
          </div>
          <div className="flex items-center gap-3" style={{ animation: 'shell-fade-in 0.3s ease-out 0.3s both' }}>
            <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--theme-surface)' }} />
            <div className="h-8 w-8 rounded-full" style={{ backgroundColor: 'var(--theme-surface-border)' }} />
          </div>
        </div>

        {/* Content area with centered loading */}
        <main className="flex-1 flex flex-col items-center justify-center" style={{ backgroundColor: 'var(--theme-surface)' }}>
          <div className="flex flex-col items-center gap-4" style={{ animation: 'shell-fade-in 0.4s ease-out 0.2s both' }}>
            {/* Animated logo spinner */}
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full" style={{ border: '2px solid var(--theme-surface-border)' }} />
              <div className="absolute inset-0 rounded-full" style={{ border: '2px solid transparent', borderTopColor: 'var(--theme-primary)', animation: 'spin 0.8s linear infinite' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold" style={{ color: 'var(--theme-primary-text)' }}>ut</span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>Loading your workspace</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>Setting up your dashboard...</p>
            </div>
            {/* Progress bar */}
            <div className="w-48 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--theme-surface-border)' }}>
              <div className="h-full rounded-full" style={{ backgroundColor: 'var(--theme-primary)', animation: 'shell-progress 1.5s ease-in-out infinite' }} />
            </div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes shell-enter { from { opacity: 0; } to { opacity: 1; } }
        @keyframes shell-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shell-progress { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
      `}</style>
    </div>
  )
}
