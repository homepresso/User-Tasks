import { notFound } from 'next/navigation'
import { fromSession } from '@/lib/services/context'
import { queryPageAccess } from '@/lib/services/query-settings'
import { QuerySettingsPage } from '@/components/settings/query-settings'

/**
 * Settings → Query. Self-hosted: per workspace (View settings to read, Edit
 * settings to change). Cloud edition: one configuration for every workspace,
 * instance admins only (INSTANCE_ADMIN_EMAILS / instance.admin_emails, like
 * Infrastructure) — everyone else, workspace owners included, gets a 404.
 */
export const dynamic = 'force-dynamic'

export default async function QueryPage() {
  const access = await queryPageAccess(await fromSession().catch(() => null))
  if (access.cloud && !access.canView) notFound()
  return <QuerySettingsPage access={access} />
}
