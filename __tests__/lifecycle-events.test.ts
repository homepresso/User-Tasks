import { describe, it, expect } from 'vitest'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'

function makeSupabase(behavior: 'ok' | 'error' | 'throw' = 'ok') {
  const inserts: any[] = []
  return {
    _inserts: inserts,
    from: () => ({
      insert: async (row: any) => {
        if (behavior === 'throw') throw new Error('network down')
        inserts.push(row)
        return { data: null, error: behavior === 'error' ? { message: 'db says no' } : null }
      },
    }),
  } as any
}

describe('writeLifecycleEvent', () => {
  it('writes the canonical row shape', async () => {
    const supabase = makeSupabase()
    await writeLifecycleEvent({
      supabase, tenantId: 't1', taskId: 'task-1', eventType: 'task_response',
      actorId: 'u1', metadata: { outcome: 'approve' },
    })
    expect(supabase._inserts).toHaveLength(1)
    expect(supabase._inserts[0]).toEqual({
      tenant_id: 't1',
      task_id: 'task-1',
      event_type: 'task_response',
      actor_id: 'u1',
      metadata: { outcome: 'approve' },
    })
  })

  it('defaults actor and metadata to null', async () => {
    const supabase = makeSupabase()
    await writeLifecycleEvent({ supabase, tenantId: 't1', taskId: 'task-1', eventType: 'completed' })
    expect(supabase._inserts[0].actor_id).toBeNull()
    expect(supabase._inserts[0].metadata).toBeNull()
  })

  it('never throws on failure', async () => {
    await expect(
      writeLifecycleEvent({ supabase: makeSupabase('throw'), tenantId: 't1', taskId: 'task-1', eventType: 'completed' }),
    ).resolves.toBeUndefined()
  })

  it('skips silently when required ids are missing', async () => {
    const supabase = makeSupabase()
    await writeLifecycleEvent({ supabase, tenantId: '', taskId: 'task-1', eventType: 'completed' })
    expect(supabase._inserts).toHaveLength(0)
  })
})
