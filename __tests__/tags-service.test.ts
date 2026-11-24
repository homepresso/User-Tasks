/**
 * Tag colours service (lib/services/tags.ts): styles readable by any member,
 * usage counted only for object types the caller may view, every write
 * gated on tags.manage, validation (palette tokens only, never hex),
 * case-insensitive matching, rename / merge through public.rename_tag with
 * an audit row, the auto-colour switch kept beside other workspace
 * settings, and the graceful "migration not applied" path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { writeAudit } from '@/lib/audit-log'
import type { ServiceContext } from '@/lib/services/context'
import * as tags from '@/lib/services/tags'
import { autoTagColor } from '@/lib/tags/palette'
import { createMemorySupabase } from './fixtures/supabase-memory'

function seed() {
  const db = createMemorySupabase({
    tag_styles: [
      { id: 's-fin', tenant_id: 'tenant-a', name: 'Finance', name_key: 'finance', color: 'green', description: 'Money matters', updated_at: '2026-11-01T00:00:00Z' },
      { id: 's-idle', tenant_id: 'tenant-a', name: 'idle', name_key: 'idle', color: null, description: 'Unused but described', updated_at: '2026-11-01T00:00:00Z' },
      { id: 's-other', tenant_id: 'tenant-b', name: 'secret', name_key: 'secret', color: 'red', description: null, updated_at: null },
    ],
    tenants: [
      { id: 'tenant-a', settings: { forms: { accessibility: { mode: 'warn' } } } },
      { id: 'tenant-b', settings: { tags: { auto_color: false } } },
    ],
  }) as any
  db.rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'tag_usage') {
      expect(args).toEqual({ p_tenant_id: 'tenant-a' })
      return {
        data: [
          { name_key: 'finance', name: 'finance', object_type: 'tasks', uses: 12 },
          { name_key: 'finance', name: 'Finance', object_type: 'workflows', uses: 3 },
          { name_key: 'urgent', name: 'Urgent', object_type: 'tasks', uses: 5 },
          { name_key: 'hidden-wf', name: 'hidden-wf', object_type: 'workflows', uses: 2 },
          { name_key: 'agentic', name: 'agentic', object_type: 'agents', uses: 1 },
        ],
        error: null,
      }
    }
    if (name === 'tag_objects') {
      expect(args.p_tenant_id).toBe('tenant-a'); expect(String(args.p_key).toLowerCase()).toBe('finance')
      return { data: args.p_type === 'tasks' ? [{ id: 't1', name: 'Approve budget', parent_id: null, total: 12 }] : [{ id: 'r1', name: 'Orders', parent_id: 'int-1', total: 1 }], error: null }
    }
    if (name === 'remove_tag') return { data: { objects: { tasks: 3, forms: 1 } }, error: null }
    if (name === 'rename_tag') return { data: { objects: { tasks: 4, workflows: 1, forms: 0 }, merged: args.p_to === 'Finance', name: args.p_to }, error: null }
    return { data: null, error: { message: `unknown rpc ${name}` } }
  })
  return db
}

/** API-key contexts use their own client for service-role work (serviceRoleClient). */
function ctx(db: any, permissions: string[], tenantId = 'tenant-a'): ServiceContext {
  return { db, supabase: db, tenantId, actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}

let db: any
beforeEach(() => {
  db = seed()
  vi.mocked(writeAudit).mockClear()
})

describe('reading tag styles', () => {
  it('any member reads the workspace styles and the auto-colour switch (default on)', async () => {
    const result = await tags.listTagStyles(ctx(db, []))
    expect(result.settings).toEqual({ auto_color: true, allow_new: true })
    expect(result.styles.map((s) => s.key).sort()).toEqual(['finance', 'idle'])
    expect(result.styles.find((s) => s.key === 'finance')).toMatchObject({ name: 'Finance', color: 'green', description: 'Money matters' })
  })

  it('never returns another workspace\'s styles and reads its own auto-colour switch', async () => {
    const result = await tags.listTagStyles(ctx(db, [], 'tenant-b'))
    expect(result.styles.map((s) => s.key)).toEqual(['secret'])
    expect(result.settings.auto_color).toBe(false)
  })

  it('treats a missing tag_styles table (migration not applied) as no styles', async () => {
    const broken = { from: (table: string) => table === 'tag_styles'
      ? { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: '42P01', message: 'relation "public.tag_styles" does not exist' } }) }) }) }) }
      : db.from(table) }
    const result = await tags.listTagStyles(ctx(broken, []))
    expect(result.styles).toEqual([])
  })
})

describe('listing tags in use', () => {
  it('merges usage with styles, counting only the object types the caller may view', async () => {
    const { tags: list, object_types } = await tags.listTags(ctx(db, ['tasks.view_all', 'agents.view']))
    expect(object_types.map((t) => t.type)).toEqual(['tasks', 'agents'])
    const finance = list.find((t) => t.key === 'finance')!
    expect(finance).toMatchObject({ name: 'Finance', color: 'green', chosen_color: 'green', styled: true, total: 12, usage: { tasks: 12 } })
    expect(finance.usage.workflows).toBeUndefined()
    // A tag only on workflows (not viewable here) does not leak.
    expect(list.find((t) => t.key === 'hidden-wf')).toBeUndefined()
    // Unstyled tags carry their automatic colour; styled-but-unused tags are listed with total 0.
    expect(list.find((t) => t.key === 'urgent')).toMatchObject({ color: autoTagColor('urgent'), chosen_color: null, styled: false, total: 5 })
    expect(list.find((t) => t.key === 'idle')).toMatchObject({ total: 0, styled: true, description: 'Unused but described' })
    // Sorted by total use.
    expect(list[0].key).toBe('finance')
  })

  it('with no view permission at all skips the usage query', async () => {
    const result = await tags.listTags(ctx(db, []))
    expect(db.rpc).not.toHaveBeenCalled()
    expect(result.tags.map((t) => t.key).sort()).toEqual(['finance', 'idle'])
  })

  it('filters by name or description, case-insensitively', async () => {
    const { tags: list } = await tags.listTags(ctx(db, ['tasks.view_all', 'workflows.view']), { q: 'MONEY' })
    expect(list.map((t) => t.key)).toEqual(['finance'])
  })
})

describe('writing tag styles', () => {
  it('requires tags.manage for every write', async () => {
    const member = ctx(db, ['tasks.view_all', 'workflows.edit', 'settings.view'])
    await expect(tags.setTagStyle(member, { name: 'finance', color: 'red' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(tags.deleteTagStyle(member, 'finance')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(tags.renameTag(member, { from: 'finance', to: 'money' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(tags.updateTagSettings(member, { auto_color: false })).rejects.toMatchObject({ code: 'forbidden' })
    expect(db.calls.filter((c: any) => c.op !== 'select')).toEqual([])
  })

  it('accepts palette tokens or auto, never hex or CSS', async () => {
    const admin = ctx(db, ['tags.manage'])
    await expect(tags.setTagStyle(admin, { name: 'finance', color: '#ff0000' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(tags.setTagStyle(admin, { name: 'finance', color: 'red; background:url(x)' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(tags.setTagStyle(admin, { name: '', color: 'red' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(tags.setTagStyle(admin, { name: 'x'.repeat(61), color: 'red' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(tags.setTagStyle(admin, { name: 'finance', description: 'y'.repeat(281) })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('updates the existing style matched case-insensitively, in the caller\'s workspace only, and audits', async () => {
    const result = await tags.setTagStyle(ctx(db, ['tags.manage']), { name: '  FINANCE ', color: 'teal' })
    expect(result).toMatchObject({ name: 'Finance', color: 'teal', description: 'Money matters', styled: true })
    expect(db.tables.tag_styles.find((r: any) => r.id === 's-fin').color).toBe('teal')
    expect(db.tables.tag_styles.find((r: any) => r.id === 's-other').color).toBe('red')
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ objectType: 'tag', objectId: 's-fin', action: 'update', tenantId: 'tenant-a' })
  })

  it('inserts a new style with the tidied name in the caller\'s workspace', async () => {
    await tags.setTagStyle(ctx(db, ['tags.manage']), { name: '  Travel   plans ', color: 'cyan', description: 'Trips' })
    const insert = db.calls.find((c: any) => c.table === 'tag_styles' && c.op === 'insert')
    expect(insert.payload).toMatchObject({ tenant_id: 'tenant-a', name: 'Travel plans', color: 'cyan', description: 'Trips', created_by: 'user-1' })
  })

  it('"auto" with no description removes the style (back to the automatic colour)', async () => {
    const result = await tags.setTagStyle(ctx(db, ['tags.manage']), { name: 'finance', color: 'auto', description: '' })
    expect(result).toMatchObject({ styled: false, color: null })
    expect(db.tables.tag_styles.some((r: any) => r.id === 's-fin')).toBe(false)
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ action: 'delete', objectType: 'tag' })
  })

  it('"auto" keeps the row when a description remains', async () => {
    const result = await tags.setTagStyle(ctx(db, ['tags.manage']), { name: 'finance', color: 'auto' })
    expect(result).toMatchObject({ styled: true, color: null, description: 'Money matters' })
  })

  it('says which migration is needed when tag_styles is missing', async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.tag_styles' in the schema cache" } }) }) }) }) }) }
    await expect(tags.setTagStyle(ctx(broken, ['tags.manage']), { name: 'finance', color: 'red' })).rejects.toMatchObject({ status: 503, message: expect.stringContaining('20270121150000') })
  })
})

describe('rename and merge', () => {
  it('runs public.rename_tag for the caller\'s workspace and audits the rename', async () => {
    const result = await tags.renameTag(ctx(db, ['tags.manage']), { from: ' fin ', to: 'Money' })
    expect(db.rpc).toHaveBeenCalledWith('rename_tag', { p_tenant_id: 'tenant-a', p_from: 'fin', p_to: 'Money', p_actor: 'user-1' })
    expect(result).toMatchObject({ name: 'Money', merged: false, total: 5, objects: { tasks: 4, workflows: 1, forms: 0, agents: 0 } })
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ objectType: 'tag', action: 'rename', diff: { name: { before: 'fin', after: 'Money' } } })
  })

  it('reports a merge', async () => {
    const result = await tags.renameTag(ctx(db, ['tags.manage']), { from: 'money', to: 'Finance' })
    expect(result.merged).toBe(true)
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ action: 'merge' })
  })

  it('rejects an unchanged or empty name', async () => {
    await expect(tags.renameTag(ctx(db, ['tags.manage']), { from: 'a', to: 'a' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(tags.renameTag(ctx(db, ['tags.manage']), { from: 'a', to: '  ' })).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('auto-colour switch', () => {
  it('keeps other workspace settings and audits a change', async () => {
    expect(await tags.updateTagSettings(ctx(db, ['tags.manage']), { auto_color: false })).toEqual({ auto_color: false, allow_new: true })
    const tenant = db.tables.tenants.find((t: any) => t.id === 'tenant-a')
    expect(tenant.settings).toEqual({ forms: { accessibility: { mode: 'warn' } }, tags: { auto_color: false, allow_new: true } })
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ objectType: 'workspace', diff: { 'tags.auto_color': { before: true, after: false } } })
    expect((await tags.listTagStyles(ctx(db, []))).settings.auto_color).toBe(false)
  })

  it('rejects a non-boolean', async () => {
    await expect(tags.updateTagSettings(ctx(db, ['tags.manage']), { auto_color: 'no' })).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('suggestions (autocomplete)', () => {
  it('ranks exact, then prefix, then word prefix, then contains, then description; ties by usage', () => {
    const list = [
      { key: 'infinance', total: 50, description: null },
      { key: 'finance team', total: 1, description: null },
      { key: 'finance', total: 2, description: null },
      { key: 'q3 finance', total: 9, description: null },
      { key: 'budget', total: 99, description: 'finance approvals' },
      { key: 'fin', total: 5, description: null },
    ]
    expect(tags.rankTagSuggestions(list, ' FINANCE ').map((t) => t.key)).toEqual(['finance', 'finance team', 'q3 finance', 'infinance', 'budget'])
    expect(tags.rankTagSuggestions(list, '').map((t) => t.key)[0]).toBe('budget')
    expect(tags.rankTagSuggestions(list, 'zzz')).toEqual([])
    expect(tags.rankTagSuggestions(list, 'fin', 2)).toHaveLength(2)
  })

  it('returns the existing spelling as exact (case-insensitive) and whether new tags may be created', async () => {
    const member = await tags.suggestTags(ctx(db, ['tasks.view_all']), { q: 'URGENT' })
    expect(member.exact).toMatchObject({ name: 'Urgent', key: 'urgent', total: 5 })
    expect(member.suggestions[0].key).toBe('urgent')
    expect(member.can_create).toBe(true)
    await tags.updateTagSettings(ctx(db, ['tags.manage']), { allow_new: false })
    expect((await tags.suggestTags(ctx(db, ['tasks.view_all']), { q: 'x' })).can_create).toBe(false)
    expect((await tags.suggestTags(ctx(db, ['tasks.view_all', 'tags.manage']), { q: 'x' })).can_create).toBe(true)
  })
})

describe('where a tag is used', () => {
  it('lists the objects of one type with app links, needing the type\'s view permission', async () => {
    const result = await tags.listTagObjects(ctx(db, ['tasks.view_all']), { name: 'Finance', type: 'tasks', limit: 10, offset: 0 })
    expect(result).toMatchObject({ type: 'tasks', total: 12, items: [{ id: 't1', name: 'Approve budget', href: '/tasks/t1' }] })
    const refs = await tags.listTagObjects(ctx(db, ['integrations.view']), { name: 'finance', type: 'references' })
    expect(refs.items[0].href).toBe('/integrations/int-1')
    await expect(tags.listTagObjects(ctx(db, ['tasks.view_all']), { name: 'finance', type: 'workflows' })).rejects.toMatchObject({ code: 'forbidden' })
    // Task RLS is workspace-wide: own-task viewers don't get task usage.
    await expect(tags.listTagObjects(ctx(db, ['tasks.view_own']), { name: 'finance', type: 'tasks' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(tags.listTagObjects(ctx(db, ['tasks.view_own']), { name: 'finance', type: 'nope' })).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('remove from every object', () => {
  it('needs tags.manage, runs public.remove_tag and audits', async () => {
    await expect(tags.removeTag(ctx(db, ['tasks.view_all']), { name: 'finance' })).rejects.toMatchObject({ code: 'forbidden' })
    const result = await tags.removeTag(ctx(db, ['tags.manage']), { name: ' Finance ' })
    expect(db.rpc).toHaveBeenCalledWith('remove_tag', { p_tenant_id: 'tenant-a', p_name: 'Finance' })
    expect(result).toMatchObject({ total: 4, objects: { tasks: 3, forms: 1, workflows: 0 } })
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ objectType: 'tag', action: 'delete', metadata: { objects: { tasks: 3 } } })
  })
})

describe('creating a tag ahead of use', () => {
  it('keep: true stores a registry row with no colour or description', async () => {
    const result = await tags.setTagStyle(ctx(db, ['tags.manage']), { name: 'Onboarding', keep: true })
    expect(result).toMatchObject({ styled: true, color: null })
    expect(db.calls.find((c: any) => c.table === 'tag_styles' && c.op === 'insert').payload).toMatchObject({ name: 'Onboarding', color: null, description: null })
  })
})
