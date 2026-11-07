import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { WorkspaceHostFrame, WorkspaceNoAccessView } from '@/components/workspace/workspace-host-states'
import { getHostWorkspace, loginUrlFor } from '@/lib/workspace-host'
import { apexOrigin, baseDomainFromEnv } from '@/lib/workspace-address'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { pageMetadata } from '@/lib/page-title'

export const metadata = { ...pageMetadata('No access'), robots: { index: false } }
export const dynamic = 'force-dynamic'

/**
 * A signed-in person on a workspace address (acme.usertasks.com) whose
 * account isn't a member of that workspace (lib/workspace-host.ts sends them
 * here). Nothing of the workspace but its name is shown.
 */
export default async function NoAccessPage() {
  const host = await getHostWorkspace()
  const base = baseDomainFromEnv()
  if (host.kind !== 'workspace' || !base) redirect('/home')
  const { getCachedUser } = await import('@/lib/supabase/server')
  const user = await getCachedUser()
  if (!user) redirect(loginUrlFor(host.tenant, '/home'))
  const { isActiveMember } = await import('@/lib/services/workspace-address')
  if (await isActiveMember(user.id, host.tenant.id)) redirect('/home')
  const apex = apexOrigin(base, configuredAppUrl())
  const hostName = ((await headers()).get('host') ?? '').replace(/:\d+$/, '')
  return (
    <WorkspaceHostFrame homeHref={apex}>
      <WorkspaceNoAccessView
        workspaceName={host.tenant.name || host.tenant.subdomain}
        host={hostName}
        email={user.email ?? null}
        switchHref={`${apex}/home`}
        loginHref={loginUrlFor(host.tenant, '/home')}
      />
    </WorkspaceHostFrame>
  )
}
