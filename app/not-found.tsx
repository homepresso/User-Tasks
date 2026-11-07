import type { Metadata } from 'next'
import Link from 'next/link'
import { Wordmark } from '@/components/brand/logo'
import { NotFoundView } from '@/components/layout/route-states'
import { APP_NAME, TITLE_SEPARATOR } from '@/lib/page-title'
import { WorkspaceHostFrame, WorkspaceNotFoundView } from '@/components/workspace/workspace-host-states'
import { getHostWorkspace } from '@/lib/workspace-host'
import { apexOrigin, baseDomainFromEnv } from '@/lib/workspace-address'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { headers } from 'next/headers'

export const metadata: Metadata = {
  title: `Page not found${TITLE_SEPARATOR}${APP_NAME}`,
  robots: { index: false },
}

/**
 * Unmatched URLs (and notFound() outside the dashboard): the public frame.
 * On a workspace address no workspace has (acme.usertasks.com), it says so.
 */
export default async function NotFound() {
  const host = await getHostWorkspace().catch(() => ({ kind: 'none' as const }))
  const base = baseDomainFromEnv()
  if (host.kind === 'unknown' && base) {
    const apex = apexOrigin(base, configuredAppUrl())
    const name = ((await headers()).get('host') ?? '').replace(/:\d+$/, '')
    return (
      <WorkspaceHostFrame homeHref={apex}>
        <WorkspaceNotFoundView host={name} apexUrl={apex} />
      </WorkspaceHostFrame>
    )
  }
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex h-14 items-center border-b border-border-subtle px-6">
        <Link href="/" aria-label="UserTasks home" className="rounded-md">
          <Wordmark size={24} />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <NotFoundView />
      </main>
    </div>
  )
}
