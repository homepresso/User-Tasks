/**
 * Event waits for extension workflow steps (ctx.runs.waitFor / resume).
 *
 * A step returns ctx.runs.waitFor(…): the engine stores one row in
 * workflow_event_waits (tenant, extension, key, a canonical match key —
 * indexed — the conditions, the run's event id) and pauses the run like any
 * other wait (PauseError → waiting_for_event; with a timeout, the timed-pause
 * machinery schedules a delay_resume job). The extension's trigger pipeline
 * calls ctx.runs.resume({ key, match, data }) when something changes: one
 * indexed lookup finds the waiters, each one's conditions are checked against
 * the data, and matching runs are resumed through the signed resume queue
 * (task_resume jobs). No polling per run. A row whose run is no longer waiting
 * (finished, cancelled) is removed when found; the engine removes the row
 * when the run resumes (event or timeout).
 *
 * Server-only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */
import { ExtensionError, type ExtensionWaitInput, type ExtensionWaitRequest } from '@/lib/extensions/sdk'

export const EVENT_WAITS_TABLE = 'workflow_event_waits'
/** Event ids of extension waits: the timed-pause prefix, so a timeout resumes through delay_resume. */
export const EXT_WAIT_EVENT_PREFIX = 'delay_extwait_'
/** Run variable carrying the event data into the resumed step. */
export const EXT_WAIT_OUTPUT_VAR = '_ext_wait_output'

const KEY_RE = /^[a-z][a-z0-9_.-]{0,59}$/i

/** The match as one canonical, indexable string: sorted keys, values as text. */
export function matchKey(match: Record<string, unknown>): string {
  return Object.keys(match ?? {}).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(match[k] ?? ''))}`).join('&')
}

/** Validate a waitFor request (in the host, so a bad one fails in the extension's own step). */
export function waitRequest(input: ExtensionWaitInput): ExtensionWaitRequest {
  if (!input || !KEY_RE.test(String(input.key ?? ''))) throw new ExtensionError('invalid_request', 'runs.waitFor: key must be 1–60 letters, digits, _ . -', 400)
  const match = input.match && typeof input.match === 'object' && !Array.isArray(input.match) ? input.match : null
  if (!match || !Object.keys(match).length) throw new ExtensionError('invalid_request', 'runs.waitFor: match needs at least one value (e.g. the record id)', 400)
  for (const v of Object.values(match)) if (!['string', 'number', 'boolean'].includes(typeof v)) throw new ExtensionError('invalid_request', 'runs.waitFor: match values are text, numbers or booleans', 400)
  const rules = input.conditions?.rules ?? []
  if (!Array.isArray(rules) || rules.length > 20) throw new ExtensionError('invalid_request', 'runs.waitFor: at most 20 conditions', 400)
  const minutes = input.timeoutMinutes === undefined || input.timeoutMinutes === null ? undefined : Number(input.timeoutMinutes)
  if (minutes !== undefined && !(minutes > 0 && minutes <= 525_600)) throw new ExtensionError('invalid_request', 'runs.waitFor: timeoutMinutes must be between 1 and 525600 (a year)', 400)
  return {
    __ext_wait: {
      key: input.key, match, conditions: rules.length ? { logic: input.conditions?.logic === 'or' ? 'or' : 'and', rules: rules.map((r) => ({ field: String(r.field), operator: String(r.operator || 'equals'), value: r.value })) } : undefined,
      ...(minutes ? { timeoutMinutes: minutes } : {}), onTimeout: input.onTimeout === 'fail' || input.onTimeout === 'branch' ? input.onTimeout : 'continue',
      description: String(input.description ?? input.key).slice(0, 300),
    },
  }
}

export function isWaitRequest(value: unknown): value is ExtensionWaitRequest {
  return Boolean(value && typeof value === 'object' && (value as any).__ext_wait && typeof (value as any).__ext_wait === 'object')
}

/** Store the wait of a paused run (the engine, just before it pauses). */
export async function recordWait(db: any, row: { tenantId: string; runId: string | null; workflowId: string | null; nodeId: string; eventId: string; extensionId: string; wait: ExtensionWaitInput; expiresAt: Date | null }): Promise<void> {
  if (!row.runId) return
  const { error } = await db.from(EVENT_WAITS_TABLE).insert({
    tenant_id: row.tenantId, run_id: row.runId, workflow_id: row.workflowId, node_id: row.nodeId, event_id: row.eventId,
    extension_id: row.extensionId, wait_key: row.wait.key, match_key: matchKey(row.wait.match), match: row.wait.match,
    conditions: row.wait.conditions ?? null, description: row.wait.description, expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
  })
  if (error) throw new Error(`Could not record the wait: ${error.message}`)
}

/** Remove the wait of a run's step once it resumed (event, timeout). */
export async function clearWait(db: any, runId: string, nodeId: string): Promise<void> {
  await db.from(EVENT_WAITS_TABLE).delete().eq('run_id', runId).eq('node_id', nodeId)
}

/** Remove every wait of a run (cancelled, failed, finished). */
export async function clearRunWaits(db: any, runId: string): Promise<void> {
  await db.from(EVENT_WAITS_TABLE).delete().eq('run_id', runId)
}

/** Does the event data meet a wait's conditions? */
export async function conditionsMet(conditions: { logic?: string; rules: Array<{ field: string; operator: string; value?: unknown }> } | null | undefined, data: Record<string, unknown>): Promise<boolean> {
  const rules = conditions?.rules ?? []
  if (!rules.length) return true
  const { evaluateOperator } = await import('@/lib/conditions')
  // The field is a key of the event data (dotted paths allowed); "changed" compares with data._previous.
  const read = (obj: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
  const previous = (data._previous && typeof data._previous === 'object' ? data._previous : {}) as Record<string, unknown>
  const results = rules.map((r) => evaluateOperator(r.operator, read(data, r.field.replace(/^\{\{\s*|\s*\}\}$/g, '')), r.value, { previousValue: read(previous, r.field) }))
  return conditions?.logic === 'or' ? results.some(Boolean) : results.every(Boolean)
}

/**
 * ctx.runs.resume: resume the runs waiting on `key` + `match` whose
 * conditions the data meets. Returns how many resumed and how many still wait.
 */
export async function resumeWaits(db: any, scope: { tenantId: string; extensionId: string }, input: { key: string; match: Record<string, unknown>; data?: Record<string, unknown> }): Promise<{ resumed: number; waiting: number }> {
  if (!KEY_RE.test(String(input?.key ?? ''))) throw new ExtensionError('invalid_request', 'runs.resume: key must be 1–60 letters, digits, _ . -', 400)
  const data = input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data : {}
  const { data: rows, error } = await db.from(EVENT_WAITS_TABLE).select('id, run_id, event_id, conditions')
    .eq('tenant_id', scope.tenantId).eq('extension_id', scope.extensionId).eq('wait_key', input.key).eq('match_key', matchKey(input.match ?? {})).limit(500)
  if (error) throw new Error(`runs.resume failed: ${error.message}`)
  let resumed = 0, waiting = 0
  const { enqueueResume } = await import('@/lib/workflow-resume-queue')
  for (const row of (rows ?? []) as any[]) {
    if (!(await conditionsMet(row.conditions, data))) { waiting += 1; continue }
    // Two events at once may both queue a resume: the engine claims the run
    // only while it waits on this event, so the run resumes once.
    await db.from(EVENT_WAITS_TABLE).delete().eq('id', row.id)
    try {
      await enqueueResume({ tenantId: scope.tenantId, eventId: row.event_id, variables: { [EXT_WAIT_OUTPUT_VAR]: data }, supabase: db })
      resumed += 1
    } catch (error) {
      // The run is no longer waiting (finished, cancelled): the row was stale.
      if (!(error instanceof Error && error.name === 'RunNotResumableError')) console.warn('[event-waits] resume failed:', error instanceof Error ? error.message : error)
    }
  }
  return { resumed, waiting }
}
