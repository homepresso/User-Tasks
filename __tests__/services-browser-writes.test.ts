/**
 * Writes the settings, automation, integration and data views used to make
 * from the browser (providers phase 2b): tag definitions, palette favorites,
 * bulk reference tags, object reference generation, file uploads (storage
 * provider mocked) and user preferences. Permission denied/allowed and tenant
 * isolation for each. Queue job removal: workflow-queue-delete.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const storage = vi.hoisted(() => ({
  put: vi.fn(async () => {}),
  publicUrl: vi.fn((bucket: string, path: string) => `http://storage.test/${bucket}/${path}`),
}))
vi.mock('@/lib/providers/storage', () => ({ getStorageProvider: async () => storage }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
const session = vi.hoisted(() => ({ db: null as any, user: { id: 'user-1' } as { id: string } | null }))
vi.mock('@/lib/providers/db/session', () => ({
  getSessionDb: async () => session.db,
  getSessionDbWithUser: async () => ({ supabase: session.db, user: session.user }),
}))

import type { ServiceContext } from '@/lib/services/context'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import * as tags from '@/lib/services/tag-definitions'
import * as workflows from '@/lib/services/workflows'
import * as references from '@/lib/services/references'
import * as objects from '@/lib/services/objects'
import * as uploads from '@/lib/services/uploads'
import { updateUserPreferences } from '@/app/actions/profile'
import { createMemorySupabase } from './fixtures/supabase-memory'

function seed() {
  return createMemorySupabase({
    tag_definitions: [{ id: 'tag-a', tenant_id: 'tenant-a', name: 'urgent', color: '#ff0000' }, { id: 'tag-b', tenant_id: 'tenant-b', name: 'other', color: '#00ff00' }],
    node_favorites: [],
    integrations: [],
    integration_references: [
      { id: 'ref-a', tenant_id: 'tenant-a', name: 'A', tags: ['x'], request_config: { method: 'POST' }, inputs: [{ name: 'q' }], outputs: [] },
      { id: 'ref-a2', tenant_id: 'tenant-a', name: 'A2', tags: null },
      { id: 'ref-b', tenant_id: 'tenant-b', name: 'B', tags: [] },
    ],
    custom_tables: [
      { id: 'tbl-a', tenant_id: 'tenant-a', name: 'Orders', columns: [{ key: 'id' }, { key: 'total', name: 'Total', type: 'number' }] },
      { id: 'tbl-b', tenant_id: 'tenant-b', name: 'Foreign', columns: [] },
    ],
    integration_objects: [
      { id: 'obj-a', tenant_id: 'tenant-a', name: 'Orders' },
      { id: 'obj-mixed', tenant_id: 'tenant-a', name: 'Mixed' },
      { id: 'obj-b', tenant_id: 'tenant-b', name: 'Foreign' },
    ],
    integration_object_sources: [
      { object_id: 'obj-a', source_type: 'table', table_id: 'tbl-a', alias: 't1', is_primary: true, sort_order: 0 },
      { object_id: 'obj-mixed', source_type: 'table', table_id: 'tbl-a', alias: 't1', is_primary: true, sort_order: 0 },
      { object_id: 'obj-mixed', source_type: 'reference', reference_id: 'ref-a', alias: 'r1', is_primary: false, sort_order: 1 },
      { object_id: 'obj-b', source_type: 'table', table_id: 'tbl-b', alias: 't1', is_primary: true, sort_order: 0 },
    ],
  })
}
type Db = ReturnType<typeof seed>

function ctx(db: Db, permissions: string[], extra: Partial<ServiceContext> = {}): ServiceContext {
  return {
    db: db as any, supabase: db as any, tenantId: 'tenant-a', actorId: 'user-1',
    permissions: new Set(permissions), authKind: 'session', source: 'ui', ...extra,
  }
}

let db: Db
beforeEach(() => {
  db = seed()
  storage.put.mockClear()
})

describe('tag definitions', () => {
  it('creates in the caller\'s tenant with the list\'s edit permission', async () => {
    const tag = await tags.createTagDefinition(ctx(db, ['workflows.edit']), 'workflows', { name: ' ops ', color: '#123456' })
    expect(tag).toMatchObject({ name: 'ops', color: '#123456' })
    expect(db.tables.tag_definitions!.find((t: any) => t.name === 'ops')).toMatchObject({ tenant_id: 'tenant-a' })
  })

  it('denies without the scope\'s permission and validates colours', async () => {
    await expect(tags.createTagDefinition(ctx(db, ['workflows.edit']), 'integrations', { name: 'x', color: '#fff' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(tags.createTagDefinition(ctx(db, ['workflows.edit']), 'workflows', { name: 'x', color: 'red; background:url(x)' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('recolours only tags of the caller\'s tenant', async () => {
    await tags.updateTagDefinitionColor(ctx(db, ['integrations.edit']), 'integrations', 'tag-a', '#000000')
    expect(db.tables.tag_definitions![0]!.color).toBe('#000000')
    await expect(tags.updateTagDefinitionColor(ctx(db, ['integrations.edit']), 'integrations', 'tag-b', '#000000')).rejects.toMatchObject({ code: 'not_found' })
    expect(db.tables.tag_definitions![1]!.color).toBe('#00ff00')
  })
})

describe('palette favorites', () => {
  it('stars and unstars node types for the tenant (workflows.edit)', async () => {
    await workflows.setNodeFavorite(ctx(db, ['workflows.edit']), 'http_request', true)
    expect(db.tables.node_favorites).toEqual([expect.objectContaining({ tenant_id: 'tenant-a', node_type: 'http_request' })])
    await workflows.setNodeFavorite(ctx(db, ['workflows.edit']), 'http_request', false)
    expect(db.tables.node_favorites).toEqual([])
    await expect(workflows.setNodeFavorite(ctx(db, ['workflows.view']), 'x', true)).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('bulk reference tags', () => {
  it('adds the tag once, skips other tenants and queues sync', async () => {
    const result = await references.addTagToReferences(ctx(db, ['integrations.manage_references']), ['ref-a', 'ref-a2', 'ref-b'], ' X ')
    expect(result).toEqual({ updated: 1 })
    const byId = (id: string) => db.tables.integration_references!.find((r: any) => r.id === id)
    expect(byId('ref-a')!.tags).toEqual(['x'])
    expect(byId('ref-a2')!.tags).toEqual(['x'])
    expect(byId('ref-b')!.tags).toEqual([])
    expect(recordAssetChange).toHaveBeenCalled()
  })

  it('denies without integrations.manage_references', async () => {
    await expect(references.addTagToReferences(ctx(db, ['integrations.edit']), ['ref-a'], 'y')).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('object reference generation', () => {
  it('generates CRUD references for table-only objects under the __objects__ integration', async () => {
    const result = await objects.generateObjectReferences(ctx(db, ['integrations.manage_references']), 'obj-a')
    expect(result.created).toBe(5)
    const integration = db.tables.integrations!.find((i: any) => i.name === objects.OBJECTS_INTEGRATION_NAME)
    expect(integration).toMatchObject({ tenant_id: 'tenant-a' })
    const generated = db.tables.integration_references!.filter((r: any) => r.request_config?.object_id === 'obj-a')
    expect(generated.map((r: any) => r.request_config.operation)).toEqual(['list', 'get', 'insert', 'update', 'delete'])
    expect(generated.every((r: any) => r.tenant_id === 'tenant-a' && r.integration_id === integration!.id)).toBe(true)
    expect(generated[0].outputs).toEqual([expect.objectContaining({ name: 'Total', path: 'total', type: 'number' })])
  })

  it('generates passthrough + list references for mixed objects', async () => {
    const result = await objects.generateObjectReferences(ctx(db, ['integrations.manage_references']), 'obj-mixed')
    expect(result.created).toBe(2)
    const names = db.tables.integration_references!.filter((r: any) => r.request_config?.object_id === 'obj-mixed').map((r: any) => r.name)
    expect(names).toEqual(['Mixed: A', 'Mixed: List Orders'])
  })

  it('cannot generate for another tenant\'s object or without permission', async () => {
    await expect(objects.generateObjectReferences(ctx(db, ['integrations.manage_references']), 'obj-b')).rejects.toMatchObject({ code: 'not_found' })
    await expect(objects.generateObjectReferences(ctx(db, ['integrations.edit']), 'obj-a')).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('uploads', () => {
  const file = (name: string, type: string, size = 10) => ({ name, type, bytes: new Uint8Array(size).fill(1) })

  it('stores integration icons in task-files/integration-icons and returns the public URL', async () => {
    const stored = await uploads.uploadIntegrationIcon(ctx(db, ['integrations.create']), file('logo.SVG', 'image/svg+xml'))
    expect(stored.path).toMatch(/^integration-icons\/[0-9a-f-]{36}\.svg$/)
    expect(stored.url).toBe(`http://storage.test/task-files/${stored.path}`)
    expect(storage.put).toHaveBeenCalledWith('task-files', stored.path, expect.any(Uint8Array), { contentType: 'image/svg+xml', upsert: undefined })
  })

  it('enforces permissions, image types and the 512 KB icon limit', async () => {
    await expect(uploads.uploadIntegrationIcon(ctx(db, ['integrations.view']), file('a.png', 'image/png'))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(uploads.uploadReferenceIcon(ctx(db, ['integrations.manage_references']), file('a.html', 'text/html'))).rejects.toMatchObject({ code: 'validation_error' })
    await expect(uploads.uploadReferenceIcon(ctx(db, ['integrations.manage_references']), file('a.png', 'image/png', uploads.ICON_MAX_BYTES + 1))).rejects.toMatchObject({ status: 413 })
    expect(storage.put).not.toHaveBeenCalled()
  })

  it('stores data-table files under the table, only for the caller\'s tables', async () => {
    const stored = await uploads.uploadDataTableFile(ctx(db, ['data.manage_rows']), 'tbl-a', file('report.final.PDF', 'application/pdf', 42))
    expect(stored).toMatchObject({ name: 'report.final.PDF', size: 42 })
    expect(stored.path).toMatch(/^data-tables\/tbl-a\/[0-9a-f-]{36}\.pdf$/)
    await expect(uploads.uploadDataTableFile(ctx(db, ['data.manage_rows']), 'tbl-b', file('x.txt', 'text/plain'))).rejects.toMatchObject({ code: 'not_found' })
    await expect(uploads.uploadDataTableFile(ctx(db, ['data.view']), 'tbl-a', file('x.txt', 'text/plain'))).rejects.toMatchObject({ code: 'forbidden' })
    expect(storage.put).toHaveBeenCalledTimes(1)
  })

  it('replaces workspace logos in the tenant folder with a cache-busting URL (settings.edit)', async () => {
    const stored = await uploads.uploadWorkspaceLogo(ctx(db, ['settings.edit']), 'favicon', file('icon.ico', 'image/x-icon'))
    expect(stored.path).toBe('tenant-a/favicon.ico')
    expect(stored.url).toMatch(/^http:\/\/storage\.test\/logos\/tenant-a\/favicon\.ico\?t=\d+$/)
    expect(storage.put).toHaveBeenCalledWith('logos', 'tenant-a/favicon.ico', expect.any(Uint8Array), { contentType: 'image/x-icon', upsert: true })
    await expect(uploads.uploadWorkspaceLogo(ctx(db, ['settings.view']), 'logo', file('l.png', 'image/png'))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(uploads.uploadWorkspaceLogo(ctx(db, ['settings.edit']), 'logo', file('l.gif', 'image/gif'))).rejects.toMatchObject({ code: 'validation_error' })
    await expect(uploads.uploadWorkspaceLogo(ctx(db, ['settings.edit']), 'favicon', file('l.png', 'image/png', 512 * 1024 + 1))).rejects.toMatchObject({ status: 413 })
  })
})

describe('updateUserPreferences', () => {
  beforeEach(() => {
    session.db = createMemorySupabase({ users: [{ id: 'user-1', preferences: { notifications_enabled: false } }, { id: 'user-2', preferences: {} }] })
    session.user = { id: 'user-1' }
  })

  it('merges into the caller\'s own preferences and clamps hours', async () => {
    const result = await updateUserPreferences({ default_priority: 'high', queue_bypass_priority: 'critical', available_hours_week: 500, hours_per_day: { mon: 30, tue: 7.5 } })
    expect(result).toEqual({ error: null })
    const [me, other] = session.db.tables.users
    expect(me.preferences).toEqual({
      notifications_enabled: false, default_priority: 'high', queue_bypass_priority: 'critical', available_hours_week: 168,
      hours_per_day: { mon: 24, tue: 7.5, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    })
    expect(other.preferences).toEqual({})
  })

  it('rejects unknown priorities and signed-out callers', async () => {
    expect(await updateUserPreferences({ default_priority: 'urgent', queue_bypass_priority: 'high', available_hours_week: 40, hours_per_day: {} })).toEqual({ error: 'Choose a priority from the list.' })
    session.user = null
    expect(await updateUserPreferences({ default_priority: 'high', queue_bypass_priority: 'high', available_hours_week: 40, hours_per_day: {} })).toEqual({ error: 'Not signed in.' })
  })
})
