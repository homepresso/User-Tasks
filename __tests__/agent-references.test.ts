import { describe, it, expect, vi } from 'vitest'
import { findWorkflowsReferencingAgent, deactivateWorkflowsReferencingAgent } from '@/lib/agent-references'

// Minimal supabase stub: from('workflows').select().eq() resolves to { data }.
function makeSupabase(workflows: any[], captureUpdate?: (ids: any) => void) {
  return {
    from(_table: string) {
      const builder: any = {
        _updatePayload: null,
        select() { return builder },
        update(payload: any) { builder._updatePayload = payload; return builder },
        eq() { return builder },
        in(_col: string, ids: any) { captureUpdate?.(ids); return Promise.resolve({ error: null }) },
        then(resolve: any) { return resolve({ data: workflows }) },
      }
      return builder
    },
  } as any
}

const WORKFLOWS = [
  { id: 'wf1', name: 'Approval Flow', nodes: [{ type: 'run_agent', config: { agent_id: 'agent-x' } }] },
  { id: 'wf2', name: 'Other', nodes: [{ type: 'text_template', config: {} }] },
  { id: 'wf3', name: 'Nested', nodes: [{ type: 'run_agent', config: { agent_id: 'agent-y' } }] },
]

describe('findWorkflowsReferencingAgent', () => {
  it('returns only workflows whose nodes reference the agent', async () => {
    const found = await findWorkflowsReferencingAgent(makeSupabase(WORKFLOWS), 'tenant-1', 'agent-x')
    expect(found).toEqual([{ id: 'wf1', name: 'Approval Flow' }])
  })

  it('returns empty when no workflow references the agent', async () => {
    const found = await findWorkflowsReferencingAgent(makeSupabase(WORKFLOWS), 'tenant-1', 'agent-none')
    expect(found).toEqual([])
  })
})

describe('deactivateWorkflowsReferencingAgent', () => {
  it('deactivates referencing workflows and returns them', async () => {
    let updatedIds: any = null
    const supabase = makeSupabase(WORKFLOWS, (ids) => { updatedIds = ids })
    const result = await deactivateWorkflowsReferencingAgent(supabase, 'tenant-1', 'agent-x')
    expect(result).toEqual([{ id: 'wf1', name: 'Approval Flow' }])
    expect(updatedIds).toEqual(['wf1'])
  })

  it('is a no-op (no update) when nothing references the agent', async () => {
    let called = false
    const supabase = makeSupabase(WORKFLOWS, () => { called = true })
    const result = await deactivateWorkflowsReferencingAgent(supabase, 'tenant-1', 'agent-none')
    expect(result).toEqual([])
    expect(called).toBe(false)
  })
})
