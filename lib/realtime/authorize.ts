import { parseSubscriptionKey, topicDef, type ParsedSubscription } from './topics'
import type { Audience } from './events'

/**
 * Subscription authorisation and audience loading for the SSE realtime
 * route. Both run as the signed-in user on the cookie-bound client, so the
 * tenant sets come from the same SQL functions the RLS policies call.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionDb = any

export const MAX_SUBSCRIPTIONS = 32

export interface AuthorizeInput {
  userId: string
  /** Permission keys (null = ungated). */
  permissions: ReadonlySet<string> | null
  db: SessionDb
}

export interface AuthorizeResult {
  accepted: ParsedSubscription[]
  rejected: Array<{ key: string; reason: string }>
}

/** Values from rpc() returning uuid[] or SETOF uuid (rows may be objects). */
function uuidList(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  return data.map((row) => String(typeof row === 'object' && row !== null ? Object.values(row)[0] : row)).filter(Boolean)
}

/**
 * Accepts or rejects each requested subscription key. Rejected ones are
 * reported to the client and never matched; the rest of the stream still
 * works (one stale task page must not break the tab's other subscriptions).
 *
 *  - user-scoped filters (assignee/assigner/notification user) must name the
 *    caller: nobody can subscribe to someone else's queue or notifications;
 *  - log topics need settings.view, as the live log reads do;
 *  - task-scoped filters need the task to be visible to the caller (RLS read).
 */
export async function authorizeSubscriptions(input: AuthorizeInput, keys: readonly string[]): Promise<AuthorizeResult> {
  const accepted: ParsedSubscription[] = []
  const rejected: AuthorizeResult['rejected'] = []
  const taskChecks: Array<{ sub: ParsedSubscription; taskId: string }> = []
  const seen = new Set<string>()
  for (const key of keys) {
    const sub = parseSubscriptionKey(key)
    if (!sub) {
      rejected.push({ key: String(key).slice(0, 200), reason: 'invalid' })
      continue
    }
    if (seen.has(sub.key)) continue
    seen.add(sub.key)
    const def = topicDef(sub.topic)
    const { column, value } = sub.filter
    if (column && def.userScoped?.includes(column) && value?.toLowerCase() !== input.userId.toLowerCase()) {
      rejected.push({ key: sub.key, reason: 'forbidden' })
      continue
    }
    if (def.log && input.permissions && !input.permissions.has('settings.view')) {
      rejected.push({ key: sub.key, reason: 'forbidden' })
      continue
    }
    if (column && value && def.taskScoped?.includes(column)) {
      taskChecks.push({ sub, taskId: value.toLowerCase() })
      continue
    }
    accepted.push(sub)
  }

  if (taskChecks.length > 0) {
    const ids = [...new Set(taskChecks.map((c) => c.taskId))]
    const { data, error } = await input.db.from('tasks').select('id').in('id', ids)
    if (error) throw new Error(error.message)
    const visible = new Set(((data ?? []) as Array<{ id: string }>).map((r) => String(r.id).toLowerCase()))
    for (const { sub, taskId } of taskChecks) {
      if (visible.has(taskId)) accepted.push(sub)
      else rejected.push({ key: sub.key, reason: 'not_found' })
    }
  }
  return { accepted, rejected }
}

/** The caller's audience (see events.ts), read through RLS-evaluating functions. */
export async function loadAudience(db: SessionDb, userId: string): Promise<Audience> {
  const [visible, member, profile] = await Promise.all([
    db.rpc('rls_visible_tenant_ids'),
    db.rpc('get_user_tenant_ids'),
    db.from('users').select('tenant_id, current_tenant_id').eq('id', userId).maybeSingle(),
  ])
  for (const res of [visible, member, profile]) if (res.error) throw new Error(res.error.message)
  if (!profile.data) throw new Error('No profile')
  const home = profile.data.tenant_id ? String(profile.data.tenant_id) : null
  const current = profile.data.current_tenant_id ? String(profile.data.current_tenant_id) : home
  return {
    userId,
    visible: new Set(uuidList(visible.data)),
    member: new Set(uuidList(member.data)),
    current,
    agent: new Set([home, current].filter((t): t is string => Boolean(t))),
  }
}
