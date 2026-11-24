/**
 * The Agent's "working" state in the panel (client-safe, pure): what the
 * placeholder bubble says while a turn runs, before and between streamed
 * text.
 *
 *   working   the message was just sent           "Working on it…"
 *   thinking  the server started / a tool ended   "Thinking…"
 *   tool      a tool runs                          "Reading the form…" (the tool's label)
 *   writing   text is streaming (no placeholder: the text replaces it)
 *
 * A wait with no news: after 8 s "Still working…", after 25 s "This is
 * taking longer than usual…" (measured from the last change of phase).
 *
 * Automatic provider retries (lib/agents/retry.ts) are quiet: they don't
 * change the phase, so the bubble keeps saying it is working (and the timing
 * hints keep counting). Nothing about providers, rate limits or attempts is
 * shown live; people who manage the Agent see the retries in the turn's
 * Details afterwards, and every retry is in the server logs / run traces.
 */

export type AgentActivityPhase = 'working' | 'thinking' | 'tool' | 'writing'

export interface AgentActivity {
  phase: AgentActivityPhase
  /** The tool's label (phase 'tool'). */
  label?: string
  /** When this phase started (ms). */
  since: number
}

export const STILL_WORKING_MS = 8_000
export const TAKING_LONGER_MS = 25_000

export function activityText(activity: AgentActivity | null, now: number = Date.now()): { text: string; hint: string | null } | null {
  if (!activity || activity.phase === 'writing') return null
  const elapsed = now - activity.since
  const hint = elapsed >= TAKING_LONGER_MS ? 'This is taking longer than usual…' : elapsed >= STILL_WORKING_MS ? 'Still working…' : null
  if (activity.phase === 'tool') return { text: `${String(activity.label ?? 'Working').replace(/…$/, '')}…`, hint }
  const base = activity.phase === 'working' ? 'Working on it…' : 'Thinking…'
  return { text: hint ?? base, hint: null }
}
