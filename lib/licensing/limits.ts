/**
 * Licence limits (usage vs. limit), e.g. SharePoint licensed per farm:
 * the licence carries `{ "sharepoint.farms": 2 }` and the extension counts
 * its registered farms before adding one:
 *
 *   const decision = await getEntitlementPort().check({ tenantId, extensionId: 'sharepoint' })
 *   const verdict = checkLimit({ limits: decision.limits, key: 'sharepoint.farms', usage: await countFarms() })
 *   if (!verdict.allowed) throw new ServiceError('extension_limit_reached', verdict.reason, …)
 *
 * or in one call with checkUsageLimit(). Limits are checked when something is
 * created (adding a third farm), never retroactively: lowering a limit does
 * not switch off what already exists.
 *
 * Extensions register a usage counter per limit key (registerUsageCounter)
 * so Settings → Licence and `usertasks-admin licence status` can show usage.
 */

import type { EntitlementDecision } from './types'

export interface LimitVerdict {
  allowed: boolean
  key: string
  /** null = no limit for this key. */
  limit: number | null
  usage: number
  /** How many more fit (null = unlimited). */
  remaining: number | null
  reason?: string
}

export interface CheckLimitInput {
  limits: Record<string, number> | null | undefined
  /** Namespaced key, e.g. `sharepoint.farms`. */
  key: string
  /** Current usage (before the addition). */
  usage: number
  /** How many are being added (default 1; 0 = just report). */
  adding?: number
  /**
   * A licence without this key: `allow` (default — the licence sets no limit,
   * i.e. unlimited) or `deny` (the extension requires the limit to be granted).
   */
  missing?: 'allow' | 'deny'
}

export function checkLimit(input: CheckLimitInput): LimitVerdict {
  const usage = Math.max(0, Math.floor(Number(input.usage) || 0))
  const adding = Math.max(0, Math.floor(input.adding ?? 1))
  const raw = input.limits?.[input.key]
  if (raw === undefined || raw === null || !Number.isFinite(raw)) {
    if (input.missing === 'deny') {
      return { allowed: false, key: input.key, limit: 0, usage, remaining: 0, reason: `The licence does not include ${input.key}.` }
    }
    return { allowed: true, key: input.key, limit: null, usage, remaining: null }
  }
  const limit = Math.max(0, Math.floor(raw))
  const allowed = usage + adding <= limit
  const remaining = Math.max(0, limit - usage)
  return allowed
    ? { allowed, key: input.key, limit, usage, remaining }
    : { allowed, key: input.key, limit, usage, remaining, reason: `Licence limit reached for ${input.key}: ${usage} of ${limit} in use${adding > 1 ? `, ${adding} more requested` : ''}. Upgrade the licence to add more.` }
}

/** Entitlement + limit in one: denied when the extension isn't licensed, or the limit is reached. */
export async function checkUsageLimit(input: {
  decision: EntitlementDecision
  key: string
  countUsage: () => Promise<number>
  adding?: number
  missing?: 'allow' | 'deny'
}): Promise<LimitVerdict> {
  if (!input.decision.allowed) {
    return { allowed: false, key: input.key, limit: null, usage: 0, remaining: 0, reason: input.decision.reason ?? `Not licensed (${input.decision.state}).` }
  }
  if (input.decision.state === 'not_required') return { allowed: true, key: input.key, limit: null, usage: 0, remaining: null }
  return checkLimit({ limits: input.decision.limits, key: input.key, usage: await input.countUsage(), adding: input.adding, missing: input.missing })
}

// ─── Usage counters (display) ──────────────────────────────────────────────

export type UsageCounter = (tenantId: string | null) => Promise<number>

const counters = new Map<string, UsageCounter>()

/** An extension registers how to count a limit key (instance-wide when tenantId is null). */
export function registerUsageCounter(key: string, counter: UsageCounter): void {
  counters.set(key, counter)
}

export function unregisterUsageCounter(key: string): void {
  counters.delete(key)
}

/** Usage of every registered key among `keys` (missing counter → null; errors → null). */
export async function usageFor(keys: string[], tenantId: string | null = null): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}
  await Promise.all(keys.map(async (key) => {
    const counter = counters.get(key)
    if (!counter) { out[key] = null; return }
    try { out[key] = await counter(tenantId) } catch { out[key] = null }
  }))
  return out
}
