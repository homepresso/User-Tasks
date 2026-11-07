import { describe, expect, it } from 'vitest'
import { overlayFromSafe, peopleInvolved, progressLabel, progressStatus, safeEdge, safeNode, safeOverlay } from '@/lib/home/progress'
import { getBranchLabels } from '@/lib/workflow-branches'
import { nodeCardModel } from '@/components/automations/workflow-node-card'
import { insertWithOptionalColumns, runOriginColumns } from '@/lib/workflow-engine'
import { homeTabKey, HOME_TABS, restoreHomeTab } from '@/components/home/home-tabs'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON */

describe('Home progress helpers', () => {
  it('maps run statuses to Home statuses and labels', () => {
    expect(progressStatus('waiting_for_event')).toBe('waiting')
    expect(progressStatus('paused')).toBe('waiting')
    expect(progressStatus('cancelled')).toBe('cancelled')
    expect(progressStatus(null, true)).toBe('queued')
    expect(progressStatus(null)).toBe('none')
    expect(progressLabel('waiting', [{ name: 'Manager approval' }, { name: 'Manager approval' }, { name: 'Legal' }])).toBe('Waiting on Manager approval, Legal')
    expect(progressLabel('queued')).toBe('Starting')
  })

  it('lists the people involved once, teams when nobody has it', () => {
    expect(peopleInvolved([
      { node_id: 'a', name: 'A', assignees: [{ id: '1', name: 'Ann' }], team: null, since: null, due_date: null },
      { node_id: 'b', name: 'B', assignees: [{ id: '1', name: 'Ann' }, { id: '2', name: 'Bo' }], team: null, since: null, due_date: null },
      { node_id: 'c', name: 'C', assignees: [], team: 'Finance', since: null, due_date: null },
    ])).toEqual(['Ann', 'Bo', 'Finance'])
  })

  it('strips a node to what draws the card, keeping branch ports', () => {
    const node = {
      id: 'sw', type: 'switch_case', label: 'Route', position: { x: 10, y: 20 }, sectionId: 's1',
      config: { expression: '{{secret_var}}', cases: [{ value: 'big', label: 'Big' }, 'small'], node_color: '#123456', api_key: 'k' },
    }
    const safe = safeNode(node)!
    expect(safe).toEqual({
      id: 'sw', type: 'switch_case', label: 'Route', position: { x: 10, y: 20 }, sectionId: 's1',
      config: { __safe: true, __branch_labels: ['Big', 'small', 'Default'], node_color: '#123456' },
    })
    expect(getBranchLabels(safe as any)).toEqual(getBranchLabels(node as any))
    const model = nodeCardModel(safe as any)
    expect(model.summary).toBeNull()
    expect(model.validationErrors).toEqual([])
    expect(JSON.stringify(safe)).not.toContain('secret_var')
    expect(safeNode(null)).toBeNull()
  })

  it('keeps edges’ ends, label and port only', () => {
    expect(safeEdge({ id: 'e', source: 'a', target: 'b', label: 'Yes', sourcePort: 'right', data: { x: 1 } })).toEqual({ id: 'e', source: 'a', target: 'b', label: 'Yes', sourcePort: 'right' })
  })

  it('drops step errors from the overlay and round-trips traversed', () => {
    const safe = safeOverlay({ nodes: { a: { status: 'failed', error: 'secret stack' } }, edges: { e: 'danger' }, traversed: new Set(['a']) })
    expect(JSON.stringify(safe)).not.toContain('secret')
    expect(overlayFromSafe(safe).traversed.has('a')).toBe(true)
  })
})

describe('run origin columns (engine)', () => {
  const sub = '11111111-2222-4333-8444-555555555555'
  it('records the person and, for form starts only, the submission', () => {
    expect(runOriginColumns({ userId: sub, via: 'form' }, { form_submission_id: sub }, false)).toEqual({ started_by: sub, started_via: 'form', form_submission_id: sub })
    expect(runOriginColumns({ userId: sub, via: 'api' }, { form_submission_id: sub }, false)).toEqual({ started_by: sub, started_via: 'api', form_submission_id: null })
    expect(runOriginColumns(null, {}, false)).toEqual({ started_by: null, started_via: 'system', form_submission_id: null })
    expect(runOriginColumns({ userId: sub, via: 'ui' }, {}, true)).toEqual({ started_by: null, started_via: 'test', form_submission_id: null })
    expect(runOriginColumns({ userId: 'not-a-uuid', via: 'ui' }, {}, false).started_by).toBeNull()
  })

  it('inserts without optional columns the database does not have yet', async () => {
    const inserted: any[] = []
    const client: any = {
      from: () => ({
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              inserted.push(row)
              return 'started_by' in row ? { data: null, error: { message: "Could not find the 'started_by' column of 'workflow_runs' in the schema cache" } } : { data: { id: 'r1' }, error: null }
            },
          }),
        }),
      }),
    }
    const result = await insertWithOptionalColumns(client, 'workflow_runs_test', { status: 'running', started_by: 'x' }, ['started_by'])
    expect(result).toEqual({ data: { id: 'r1' }, error: null })
    expect(inserted.at(-1)).toEqual({ status: 'running' })
    // Other errors are returned, not retried.
    const failing: any = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }
    expect((await insertWithOptionalColumns(failing, 't', { a: 1 }, ['b'])).error?.message).toBe('boom')
  })
})

describe('Home tabs', () => {
  it('remembers the tab per user and offers the four lists (queued tasks are in My tasks), Favourite forms next to My submissions', () => {
    expect(homeTabKey('u1')).toBe('usertasks.home.tab.u1')
    expect(HOME_TABS.map((t) => t.id)).toEqual(['tasks', 'following', 'submissions', 'favorites'])
    expect(HOME_TABS.find((t) => t.id === 'favorites')).toMatchObject({ label: 'Favourite forms', perm: 'forms.submit' })
  })

  it('restores a saved tab; the retired "queue" tab falls back to My tasks', () => {
    expect(restoreHomeTab('following', HOME_TABS)).toBe('following')
    expect(restoreHomeTab('queue', HOME_TABS)).toBe('tasks')
    // Without My tasks (no tasks.view_own) an old "queue" choice keeps the default.
    expect(restoreHomeTab('queue', HOME_TABS.filter((t) => t.id !== 'tasks'))).toBeNull()
    expect(restoreHomeTab('nonsense', HOME_TABS)).toBeNull()
    expect(restoreHomeTab(null, HOME_TABS)).toBeNull()
  })
})
