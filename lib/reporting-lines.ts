/**
 * Reporting lines: who manages whom in one workspace.
 *
 * The relationship is per workspace (users can belong to several):
 * user_memberships.manager_user_id names the member's manager in that
 * tenant. It is set in Settings → Team, through the API / MCP / CLI, or by
 * directory sync from the provider's manager attribute.
 *
 * A "manager" is anyone with at least one direct report. Indirect reports
 * (reports of reports) are walked breadth-first, cycle-safe and capped at
 * MAX_REPORTING_DEPTH levels — the database refuses cycles on write, the cap
 * and the visited set keep a bad import from looping here anyway.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

export const MAX_REPORTING_DEPTH = 10

export interface ReportingLine {
  user_id: string
  manager_user_id: string | null
}

export interface ReportEntry {
  user_id: string
  /** 1 = direct report, 2 = report of a report, … */
  depth: number
  /** The report's own manager (the actor for depth 1). */
  manager_user_id: string
}

export interface ReportingIndex {
  managerOf: Map<string, string>
  reportsOf: Map<string, string[]>
}

export function buildReportingIndex(lines: readonly ReportingLine[]): ReportingIndex {
  const managerOf = new Map<string, string>()
  const reportsOf = new Map<string, string[]>()
  for (const line of lines) {
    const user = String(line.user_id ?? '')
    const manager = line.manager_user_id ? String(line.manager_user_id) : ''
    if (!user || !manager || user === manager) continue
    managerOf.set(user, manager)
    const list = reportsOf.get(manager)
    if (list) list.push(user)
    else reportsOf.set(manager, [user])
  }
  return { managerOf, reportsOf }
}

/** Direct (and with `indirect`, all transitive) reports of `managerId`. */
export function listReports(index: ReportingIndex, managerId: string, options: { indirect?: boolean; maxDepth?: number } = {}): ReportEntry[] {
  const maxDepth = options.indirect ? Math.max(1, Math.min(options.maxDepth ?? MAX_REPORTING_DEPTH, MAX_REPORTING_DEPTH)) : 1
  const seen = new Set<string>([managerId])
  const out: ReportEntry[] = []
  let frontier: Array<{ id: string; depth: number }> = [{ id: managerId, depth: 0 }]
  while (frontier.length) {
    const next: Array<{ id: string; depth: number }> = []
    for (const { id, depth } of frontier) {
      if (depth >= maxDepth) continue
      for (const report of index.reportsOf.get(id) ?? []) {
        if (seen.has(report)) continue
        seen.add(report)
        out.push({ user_id: report, depth: depth + 1, manager_user_id: id })
        next.push({ id: report, depth: depth + 1 })
      }
    }
    frontier = next
  }
  return out
}

/** `userId`'s managers, nearest first (cycle-safe, capped). */
export function managerChain(index: ReportingIndex, userId: string, maxDepth = MAX_REPORTING_DEPTH): string[] {
  const chain: string[] = []
  const seen = new Set<string>([userId])
  let current = index.managerOf.get(userId)
  while (current && !seen.has(current) && chain.length < maxDepth) {
    chain.push(current)
    seen.add(current)
    current = index.managerOf.get(current)
  }
  return chain
}

/** True when `managerId` is in `userId`'s manager chain (direct, or indirect with `indirect`). */
export function isInManagerChain(index: ReportingIndex, managerId: string, userId: string, options: { indirect?: boolean } = { indirect: true }): boolean {
  if (!managerId || !userId || managerId === userId) return false
  const chain = managerChain(index, userId, options.indirect === false ? 1 : MAX_REPORTING_DEPTH)
  return chain.includes(managerId)
}

/** Would making `managerId` the manager of `userId` close a loop? */
export function wouldCreateCycle(index: ReportingIndex, userId: string, managerId: string | null): boolean {
  if (!managerId) return false
  if (managerId === userId) return true
  // A loop exists when userId is already in managerId's chain.
  return managerChain(index, managerId, 1000).includes(userId)
}

/** Active members' reporting lines in one workspace. */
export async function loadReportingLines(db: any, tenantId: string): Promise<ReportingLine[]> {
  const { data, error } = await db
    .from('user_memberships')
    .select('user_id, manager_user_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((row) => ({ user_id: String(row.user_id), manager_user_id: row.manager_user_id ? String(row.manager_user_id) : null }))
}

export async function loadReportingIndex(db: any, tenantId: string): Promise<ReportingIndex> {
  return buildReportingIndex(await loadReportingLines(db, tenantId))
}
