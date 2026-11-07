import { describe, expect, it } from 'vitest'
import { agentActingUserId } from '@/lib/agents/identity'
import { initiatorVariables } from '@/lib/workflow-initiator'

/** Who a Run Agent step's agent acts for (least privilege). */
describe('agentActingUserId', () => {
  const OWNER = 'owner-1'
  it('a person who started the run', () => {
    expect(agentActingUserId(initiatorVariables({ userId: 'alice', via: 'ui' }, OWNER), {})).toBe('alice')
    expect(agentActingUserId(initiatorVariables({ userId: 'alice', via: 'form' }, OWNER), {})).toBe('alice')
  })
  it('nobody for schedules, webhooks and public forms (not the owner)', () => {
    for (const via of ['schedule', 'webhook', 'form', 'event', 'system'] as const) {
      expect(agentActingUserId(initiatorVariables({ userId: null, via }, OWNER), {})).toBeNull()
    }
  })
  it('the owner only when the step says so; none means nobody', () => {
    const vars = initiatorVariables({ userId: null, via: 'webhook' }, OWNER)
    expect(agentActingUserId(vars, { act_as: 'owner' })).toBe(OWNER)
    expect(agentActingUserId(initiatorVariables({ userId: 'alice', via: 'ui' }, OWNER), { act_as: 'none' })).toBeNull()
  })
  it('runs paused before the variable existed fall back on started_via', () => {
    expect(agentActingUserId({ workflow_started_by: OWNER, workflow_started_via: 'schedule', workflow_owner_id: OWNER }, {})).toBeNull()
    expect(agentActingUserId({ workflow_started_by: 'bob', workflow_started_via: 'api', workflow_owner_id: OWNER }, {})).toBe('bob')
  })
})
