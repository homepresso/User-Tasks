/**
 * /api/v1/tags routes: list (any credential; usage per viewable type),
 * set / reset style, rename and the auto-colour setting (tags.manage),
 * body validation (palette tokens only), and the endpoint registry entries
 * the OpenAPI document, SDK and CLI are generated from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { GET as listTags } from '@/app/api/v1/tags/route'
import { PUT as setStyle, DELETE as resetStyle } from '@/app/api/v1/tags/style/route'
import { POST as rename } from '@/app/api/v1/tags/rename/route'
import { GET as getSettings, PATCH as patchSettings } from '@/app/api/v1/tags/settings/route'
import { GET as suggest } from '@/app/api/v1/tags/suggest/route'
import { GET as objects } from '@/app/api/v1/tags/objects/route'
import { POST as removeRoute } from '@/app/api/v1/tags/remove/route'
import { POST as apply } from '@/app/api/v1/tags/apply/route'
import { tagEndpoints } from '@/lib/api-schemas/tags'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { expandScopes } from '@/lib/oauth/scopes'
import { createMemorySupabase } from './fixtures/supabase-memory'

const mockedValidate = vi.mocked(validateApiKey)

function seed() {
  const db = createMemorySupabase({
    tag_styles: [{ id: 's1', tenant_id: 'tenant-a', name: 'finance', name_key: 'finance', color: 'green', description: null, updated_at: null }],
    tenants: [{ id: 'tenant-a', settings: {} }],
  }) as any
  db.rpc = vi.fn(async (name: string) => name === 'tag_usage'
    ? { data: [{ name_key: 'finance', name: 'finance', object_type: 'tasks', uses: 2 }, { name_key: 'ops', name: 'ops', object_type: 'workflows', uses: 1 }], error: null }
    : { data: { objects: { tasks: 2 }, merged: false, name: 'money' }, error: null })
  return db
}

function authAs(db: any, permissions: string[]) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions,
    supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}

function req(path: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`https://app.test/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

let db: any
beforeEach(() => { mockedValidate.mockReset(); db = seed() })

describe('/api/v1/tags', () => {
  it('GET /tags lists tags with colours and the usage the key may view', async () => {
    authAs(db, ['tasks.view_all'])
    const res = await listTags(req('/tags'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.total).toBe(1)
    expect(body.data.tags[0]).toMatchObject({ name: 'finance', color: 'green', usage: { tasks: 2 }, total: 2 })
    expect(body.data.settings).toEqual({ auto_color: true, allow_new: true })
  })

  it('PUT /tags/style needs tags.manage', async () => {
    authAs(db, ['tasks.view_all', 'settings.edit'])
    const res = await setStyle(req('/tags/style', { method: 'PUT', body: { name: 'finance', color: 'red' } }))
    expect(res.status).toBe(403)
  })

  it('PUT /tags/style rejects a colour outside the palette', async () => {
    authAs(db, ['tags.manage'])
    const res = await setStyle(req('/tags/style', { method: 'PUT', body: { name: 'finance', color: '#ff0000' } }))
    expect(res.status).toBe(400)
  })

  it('PUT /tags/style sets the colour', async () => {
    authAs(db, ['tags.manage'])
    const res = await setStyle(req('/tags/style', { method: 'PUT', body: { name: 'Finance', color: 'violet', description: 'Money' } }))
    expect(res.status).toBe(200)
    expect((await res.json()).data.tag).toMatchObject({ name: 'finance', color: 'violet', description: 'Money', styled: true })
  })

  it('DELETE /tags/style resets to automatic', async () => {
    authAs(db, ['tags.manage'])
    const res = await resetStyle(req('/tags/style?name=FINANCE', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(db.tables.tag_styles).toEqual([])
  })

  it('POST /tags/rename renames through the database function', async () => {
    authAs(db, ['tags.manage'])
    const res = await rename(req('/tags/rename', { method: 'POST', body: { from: 'fin', to: 'money' } }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ name: 'money', merged: false, total: 2 })
    expect(db.rpc).toHaveBeenCalledWith('rename_tag', expect.objectContaining({ p_tenant_id: 'tenant-a', p_from: 'fin', p_to: 'money' }))
  })

  it('GET / PATCH /tags/settings', async () => {
    authAs(db, ['tasks.view_own'])
    expect((await (await getSettings(req('/tags/settings'))).json()).data).toEqual({ auto_color: true, allow_new: true })
    expect((await patchSettings(req('/tags/settings', { method: 'PATCH', body: { auto_color: false } }))).status).toBe(403)
    authAs(db, ['tags.manage'])
    const res = await patchSettings(req('/tags/settings', { method: 'PATCH', body: { auto_color: false } }))
    expect((await res.json()).data).toEqual({ auto_color: false, allow_new: true })
  })
})

describe('/api/v1/tags suggest, objects, remove, apply', () => {
  it('GET /tags/suggest ranks and says whether new tags may be created', async () => {
    authAs(db, ['tasks.view_all'])
    const body = await (await suggest(req('/tags/suggest?q=FIN'))).json()
    expect(body.data.suggestions[0]).toMatchObject({ name: 'finance', color: 'green' })
    expect(body.data.can_create).toBe(true)
  })

  it('GET /tags/objects needs the type\'s view permission', async () => {
    authAs(db, ['tasks.view_own'])
    expect((await objects(req('/tags/objects?name=finance&type=workflows'))).status).toBe(403)
  })

  it('POST /tags/remove needs tags.manage', async () => {
    authAs(db, ['tasks.view_all'])
    expect((await removeRoute(req('/tags/remove', { method: 'POST', body: { name: 'finance' } }))).status).toBe(403)
  })

  it('POST /tags/apply checks the object type\'s edit permission', async () => {
    authAs(db, ['forms.view'])
    const res = await apply(req('/tags/apply', { method: 'POST', body: { type: 'forms', ids: ['f1'], add: ['finance'] } }))
    expect(res.status).toBe(403)
    expect((await apply(req('/tags/apply', { method: 'POST', body: { type: 'retention_policies', ids: ['x'], add: ['a'] } }))).status).toBe(400)
  })
})

describe('tag endpoints in the registry', () => {
  it('are registered, reads open to members and writes on tags.manage', () => {
    for (const endpoint of tagEndpoints) expect(API_ENDPOINTS).toContain(endpoint)
    const byOp = Object.fromEntries(tagEndpoints.map((e) => [e.operationId, e]))
    expect(byOp.listTags.permission).toBeNull()
    expect(byOp.getTagSettings.permission).toBeNull()
    for (const op of ['setTagStyle', 'deleteTagStyle', 'renameTag', 'removeTag', 'updateTagSettings']) expect(byOp[op].permission, op).toBe('tags.manage')
    // Object-level checks happen in the services (type view / each object's edit permission).
    for (const op of ['suggestTags', 'listTagObjects', 'applyTags']) expect(byOp[op].permission, op).toBeNull()
    expect(tagEndpoints.map((e) => e.cli?.verb)).toEqual(['list', 'suggest', 'objects', 'set-style', 'reset-style', 'rename', 'remove', 'apply', 'settings', 'update-settings'])
  })

  it('OAuth settings:write grants tags.manage', () => {
    expect(expandScopes(['settings:write'])).toContain('tags.manage')
    expect(expandScopes(['settings:read'])).not.toContain('tags.manage')
  })
})
