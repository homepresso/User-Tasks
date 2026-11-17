import { notFound } from 'next/navigation'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { isServiceError } from '@/lib/services/context'
import { isTeamRequestsAdmin, listTeamRequests, teamRequestFiltersSchema } from '@/lib/services/team-requests'
import { TeamRequestsView } from '@/components/settings/team-requests'

/**
 * Settings → Requests: every request to the UserTasks team (contact form,
 * in-app feedback, docs feedback, beta signups, trials) that notifyTeam
 * recorded. Instance admins only (the Settings → Infrastructure check);
 * everyone else gets a 404, and every action re-checks it.
 */
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function TeamRequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await getSessionDbWithUser()
  const viewer = user ? { id: user.id, email: user.email ?? null } : null
  if (!viewer || !(await isTeamRequestsAdmin(viewer))) notFound()

  const params = await searchParams
  const parsed = teamRequestFiltersSchema.safeParse({ kind: one(params.kind), status: one(params.status), q: one(params.q) })
  const filters = parsed.success ? parsed.data : teamRequestFiltersSchema.parse({})
  let initial: Awaited<ReturnType<typeof listTeamRequests>> = { items: [], nextCursor: null }
  let error: string | null = null
  try {
    initial = await listTeamRequests(viewer, { kind: filters.kind, status: filters.status, q: filters.q })
  } catch (e) {
    error = isServiceError(e) ? e.message : 'Could not load team requests'
  }
  return (
    <TeamRequestsView
      filters={{ kind: filters.kind, status: filters.status, q: filters.q ?? '' }}
      initial={initial}
      initialId={one(params.id) ?? null}
      error={error}
    />
  )
}
