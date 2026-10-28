import { notFound } from 'next/navigation'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { loadInfrastructureView, viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { InfrastructureView } from '@/components/settings/infrastructure-view'

/**
 * Settings → Infrastructure: the provider per area, health from the doctor
 * checks (cached), provider switches and settings changes (the same engine
 * as `usertasks-admin switch`), and the switch log. Instance admins only
 * (INSTANCE_ADMIN_EMAILS / instance.admin_emails) — workspace roles don't
 * grant it, and everyone else gets a 404; every action re-checks it.
 */
export const dynamic = 'force-dynamic'

export default async function InfrastructurePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getSessionDbWithUser()
  if (!(await viewerCanSeeInfrastructure(user))) notFound()
  const refresh = (await searchParams).refresh === '1'
  const view = await loadInfrastructureView({ refresh })
  return <InfrastructureView view={view} />
}
