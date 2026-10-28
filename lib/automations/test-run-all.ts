/**
 * "Run All" in the designer's Test runner never waits at a paused step: a
 * User Task is completed with the test case's saved task values when the
 * "complete with saved values" option is on and the case has values for
 * that task; anything else (no saved values, a server event) is reported
 * as "Paused at …" and the next case runs. The paused test run is cleaned
 * up like any other (lib/workflow-test-runs.ts).
 *
 * Saved task values: what the tester entered (outcome + field values) the
 * last time they completed that User Task in that case, kept per case for
 * the runner's session.
 *
 * Pure.
 */

export type TestPausePrompt =
  | { kind: 'task'; nodeId: string; title: string; outcomes: string[] }
  | { kind: 'event'; nodeId: string; eventName: string }

export interface SavedTaskValues { outcome: string; values: Record<string, unknown> }

/** Per User Task node id. */
export type CaseTaskValues = Record<string, SavedTaskValues>

export type RunAllPauseDecision =
  | { action: 'resume'; outcome: string; values: Record<string, unknown> }
  | { action: 'skip'; label: string }

export function pausedAtLabel(prompt: TestPausePrompt | null | undefined): string {
  if (!prompt) return 'Paused'
  const name = prompt.kind === 'task' ? prompt.title : prompt.eventName
  return name ? `Paused at "${name}"` : 'Paused'
}

export function runAllPauseDecision(
  prompt: TestPausePrompt | null | undefined,
  saved: CaseTaskValues | undefined,
  autoComplete: boolean,
): RunAllPauseDecision {
  if (prompt?.kind === 'task' && autoComplete) {
    const entry = saved?.[prompt.nodeId]
    if (entry) {
      const outcomes = prompt.outcomes.length ? prompt.outcomes : ['completed']
      return { action: 'resume', outcome: outcomes.includes(entry.outcome) ? entry.outcome : outcomes[0], values: { ...entry.values } }
    }
  }
  return { action: 'skip', label: pausedAtLabel(prompt) }
}

export function rememberTaskValues(saved: CaseTaskValues | undefined, nodeId: string, outcome: string, values: Record<string, unknown>): CaseTaskValues {
  return { ...(saved ?? {}), [nodeId]: { outcome, values: { ...values } } }
}

export function savedTaskValuesFor(saved: CaseTaskValues | undefined, nodeId: string): Record<string, unknown> | null {
  const entry = saved?.[nodeId]
  return entry ? { ...entry.values } : null
}
