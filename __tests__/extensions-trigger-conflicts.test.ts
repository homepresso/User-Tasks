/**
 * Trigger conflicts (lib/extensions/trigger-conflicts.ts): an extension trigger reports overlaps
 * with other workflows; answers stored in the draft (TRIGGER_CONFLICT_CHOICES) count; publishing
 * refuses unanswered conflicts unless on_conflict answers them, then hands every answer to the
 * extension; the publish service turns it into 409 trigger_conflict with the conflicts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => ({ from: () => ({}) }),
}))
import { defineExtension, defineServerExtension, TRIGGER_CONFLICT_CHOICES } from '@user-tasks/extension-sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { resolveConflictsForPublish, triggerConflicts, TriggerConflictError } from '@/lib/extensions/trigger-conflicts'

const manifest = {
  manifest_version: 1, id: 'acme', name: 'Acme', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
  engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
  licence: { tier: 'free' }, deployments: ['cloud', 'self_hosted'],
  contributes: { triggers: [{ key: 'changed', label: 'Changed', description: 'x', config: [], variables: [] }] },
}
const resolved: any[] = []
const seen: any[] = []
const server = defineServerExtension({
  id: 'acme',
  triggers: {
    changed: {
      matches: () => true,
      async conflicts({ ctx, workflowId, config }) {
        seen.push({ workflowId, actor: ctx.actorId, config })
        return (config.events as string[] ?? []).filter((e) => e === 'created').map((e) => ({ key: `${e}:W2`, message: `'Other' already starts when an item is ${e}.`, workflow: { id: 'W2', name: 'Other' }, takeOverLabel: "Remove this event from 'Other'" }))
      },
      async resolveConflicts({ workflowId, choices }) { resolved.push({ workflowId, choices }); return { notes: ['ok'] } },
    },
  },
})
const caller = { tenantId: 't1', actorId: 'u1', permissions: new Set(['workflows.activate']) }
const nodes = (config: Record<string, unknown>) => [{ id: 'log', type: 'ext.acme.log' }, { id: 't', type: 'ext.acme.changed', config }, { id: 'x', type: 'log' }]

describe('trigger conflicts', () => {
  beforeEach(() => { resolved.length = 0; seen.length = 0; registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [server] }) })
  afterEach(() => resetExtensionsForTest())

  it('reports overlaps of the trigger (not an action step), with the stored answers', async () => {
    const r = await triggerConflicts(caller, 'W1', nodes({ events: ['created', 'deleted'] }))
    expect(r.conflicts.map((c) => c.key)).toEqual(['created:W2'])
    expect(r.unanswered.map((c) => c.key)).toEqual(['created:W2'])
    expect(seen[0]).toMatchObject({ workflowId: 'W1', actor: 'u1' })
    const answered = await triggerConflicts(caller, 'W1', nodes({ events: ['created'], [TRIGGER_CONFLICT_CHOICES]: { 'created:W2': 'keep_both' } }))
    expect(answered).toMatchObject({ unanswered: [], choices: { 'created:W2': 'keep_both' } })
    expect((await triggerConflicts(caller, 'W1', [{ id: 't', type: 'manual' }])).conflicts).toEqual([])
  })

  it('publish: unanswered → TriggerConflictError; on_conflict or stored answers → the extension applies them', async () => {
    await expect(resolveConflictsForPublish(caller, 'W1', nodes({ events: ['created'] }))).rejects.toBeInstanceOf(TriggerConflictError)
    expect(resolved).toEqual([])
    expect(await resolveConflictsForPublish(caller, 'W1', nodes({ events: ['created'] }), 'take_over')).toEqual(['ok'])
    expect(resolved[0]).toEqual({ workflowId: 'W1', choices: { 'created:W2': 'take_over' } })
    await resolveConflictsForPublish(caller, 'W1', nodes({ events: ['created'], [TRIGGER_CONFLICT_CHOICES]: { 'created:W2': 'keep_both' } }))
    expect(resolved[1].choices).toEqual({ 'created:W2': 'keep_both' })
    expect(await resolveConflictsForPublish(caller, 'W1', nodes({ events: ['deleted'] }))).toEqual([])
    expect(resolved).toHaveLength(2)
  })

  it('the publish service answers 409 trigger_conflict with the conflicts, and passes on_conflict on', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('lib/services/workflows.ts', 'utf8'))
    expect(src).toMatch(/resolveConflictsForPublish\(\{ tenantId: ctx\.tenantId, actorId: ctx\.actorId, permissions: ctx\.permissions \}, workflowId, workflow\.nodes, options\.onConflict\)/)
    expect(src).toMatch(/status: 409, details: \{ code: 'trigger_conflict', conflicts: e\.conflicts \}/)
    const route = await import('node:fs').then((fs) => fs.readFileSync('app/api/v1/workflows/[id]/publish/route.ts', 'utf8'))
    expect(route).toContain('onConflict: body.on_conflict ?? null')
    const { workflowPublishBody } = await import('@/lib/api-schemas/workflows')
    expect(workflowPublishBody.parse({ on_conflict: 'keep_both' })).toEqual({ on_conflict: 'keep_both' })
    expect(() => workflowPublishBody.parse({ on_conflict: 'nope' })).toThrow()
    vi.restoreAllMocks()
  })
})
