import { notFound } from 'next/navigation'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { licenceStatusView } from '@/lib/licensing/admin'
import { LicenceView } from '@/components/settings/licence-view'

/**
 * Settings → Licence: installed licences for paid extensions (upload / paste,
 * replace, remove), expiry countdown, limits and usage, warnings, the
 * instance id and the offline activation request. Instance admins only
 * (INSTANCE_ADMIN_EMAILS / instance.admin_emails); everyone else gets a 404,
 * and every action re-checks.
 */
export const dynamic = 'force-dynamic'

export default async function LicencePage() {
  const { user } = await getSessionDbWithUser()
  if (!(await viewerCanSeeInfrastructure(user))) notFound()
  const status = await licenceStatusView({ fresh: true })
  return <LicenceView initialStatus={JSON.parse(JSON.stringify(status))} />
}
