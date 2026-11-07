/**
 * The person a Run Agent step's agent acts for (task / workflow tools), from
 * the run's engine-owned initiator variables (lib/workflow-initiator.ts).
 *
 * Least privilege: the run's initiator when a signed-in person started it;
 * nobody — the agent's own configured scope, task / workflow writes refused
 * — for schedules, webhooks, public forms and other person-less starts. The
 * workflow owner only when the step explicitly says `act_as: "owner"` (a
 * workflow editor's choice). Before this, every Run Agent step acted as the
 * owner, so text from an anonymous form could steer tools with the owner's
 * permissions.
 */
const PERSON_VIA = new Set(['ui', 'test', 'api', 'cli', 'mcp', 'agent', 'task'])

export function agentActingUserId(variables: Record<string, unknown>, config: Record<string, unknown>): string | null {
  const mode = String(config.act_as ?? 'initiator')
  if (mode === 'none') return null
  if (mode === 'owner') {
    const owner = typeof variables.workflow_owner_id === 'string' ? variables.workflow_owner_id : typeof variables.workflow_started_by === 'string' ? variables.workflow_started_by : ''
    return owner.trim() || null
  }
  const initiator = variables.workflow_initiator_user_id
  if (typeof initiator === 'string') return initiator.trim() || null
  // Runs started before workflow_initiator_user_id existed: started_by is the
  // owner fallback unless a person started the run.
  const via = String(variables.workflow_started_via ?? '')
  const startedBy = String(variables.workflow_started_by ?? '').trim()
  return PERSON_VIA.has(via) && startedBy ? startedBy : null
}
