import { notFound } from 'next/navigation'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { getWorkspaceDnsReport } from '@/lib/workspace-dns-check'
import { WorkspaceDnsView } from '@/components/settings/workspace-dns-view'

/**
 * Settings → Workspace DNS: what to set up so `<workspace>.<base domain>`
 * reaches the app (Vercel with GoDaddy / Cloudflare / another DNS host, or
 * self-hosted), with live DNS, certificate and HTTP checks. Instance admins
 * only (INSTANCE_ADMIN_EMAILS / instance.admin_emails), like Infrastructure;
 * everyone else gets a 404.
 */
export const dynamic = 'force-dynamic'

export default async function WorkspaceDnsPage() {
  const { user } = await getSessionDbWithUser()
  if (!(await viewerCanSeeInfrastructure(user))) notFound()
  const report = await getWorkspaceDnsReport()
  return <WorkspaceDnsView initialReport={report} />
}
