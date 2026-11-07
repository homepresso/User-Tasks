/**
 * Who may see and change a saved report on the service-role surfaces (REST,
 * MCP, export) — the same rule the reports_select / _update / _delete RLS
 * policies give the app (governance audit 2026-11: API keys and MCP bypass
 * RLS, so reports.view read other people's private reports and
 * reports.edit_own edited anyone's).
 *
 *  - A user-bound credential (user API key, OAuth token acting for a user):
 *    reads its user's own reports and shared ones; edits and deletes its
 *    user's own reports only.
 *  - A tenant-wide credential (no user): every report of its workspace,
 *    bounded by its explicit permission list.
 *  - Sharing or unsharing (`is_shared`) also needs reports.share.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase query builders */

/** Narrow a reports SELECT to what the actor may read. */
export function scopeReportRead<Q extends { or: (filter: string) => Q }>(query: Q, actorId: string | null | undefined): Q {
  if (!actorId) return query
  return query.or(`created_by.eq.${actorId},is_shared.eq.true`)
}

/** Narrow a reports UPDATE / DELETE to what the actor may change. */
export function scopeReportWrite<Q extends { eq: (column: string, value: string) => Q }>(query: Q, actorId: string | null | undefined): Q {
  if (!actorId) return query
  return query.eq('created_by', actorId)
}

/** An error message when the update changes sharing without reports.share, else null. */
export function reportShareDenied(updates: Record<string, unknown>, permissions: Iterable<string> | null | undefined): string | null {
  if (updates.is_shared === undefined || permissions == null) return null
  return new Set(permissions).has('reports.share') ? null : "Forbidden: sharing a report needs the 'reports.share' permission"
}
