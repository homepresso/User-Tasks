import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { buildExplorerGroups, ODATA_EXPLORER_GROUP, toExplorerEndpoint } from '@/lib/api-schemas/explorer'
import { defineEndpoint } from '@/lib/api-schemas/registry'
import { ENDPOINT_GROUPS } from '@/components/api-keys/api-explorer'

describe('API explorer groups from the registry', () => {
  const all = ENDPOINT_GROUPS.flatMap((group) => group.endpoints).filter((e) => e.path.startsWith('/api/v1/'))

  it('ships groups identical to the registry mapping (explorer.generated.json is current)', () => {
    expect(ENDPOINT_GROUPS).toEqual(JSON.parse(JSON.stringify([...buildExplorerGroups(API_ENDPOINTS), ODATA_EXPLORER_GROUP])))
  })

  it('keeps the OData group after the generated /api/v1 groups', () => {
    expect(ENDPOINT_GROUPS[ENDPOINT_GROUPS.length - 1].label).toBe('OData')
    expect(ENDPOINT_GROUPS[ENDPOINT_GROUPS.length - 1].endpoints.every((e) => e.path.startsWith('/api/odata'))).toBe(true)
  })

  it('lists every bearer endpoint exactly once, under /api/v1 (SSE streams excluded)', () => {
    const expected = API_ENDPOINTS.filter((e) => e.auth !== 'none' && !e.stream).map((e) => `${e.method} /api/v1${e.path}`).sort()
    expect(all.map((e) => `${e.method} ${e.path}`).sort()).toEqual(expected)
  })

  it('includes the governance, API key and webhook endpoints', () => {
    const keys = new Set(all.map((e) => `${e.method} ${e.path}`))
    for (const key of [
      'GET /api/v1/roles', 'PATCH /api/v1/roles/{id}', 'PUT /api/v1/users/{id}/roles/{roleId}',
      'PUT /api/v1/teams/{id}/members/{userId}', 'POST /api/v1/invitations/{id}/resend', 'GET /api/v1/audit-log',
      'POST /api/v1/api-keys', 'POST /api/v1/api-keys/{id}/revoke',
      'POST /api/v1/workflows/{id}/webhooks', 'POST /api/v1/webhooks/{id}/rotate',
    ]) expect(keys.has(key), key).toBe(true)
    expect(ENDPOINT_GROUPS.map((g) => g.label)).toEqual(expect.arrayContaining(['Roles & users', 'Teams', 'Invitations', 'API keys', 'Webhooks']))
  })

  it('maps path, query and body fields with requiredness, enums and placeholders', () => {
    const endpoint = toExplorerEndpoint(defineEndpoint({
      method: 'POST', path: '/things/{id}', operationId: 'makeThing', tags: ['Things'], summary: 'Make a thing',
      permission: 'things.make',
      params: z.object({ id: z.string() }),
      query: z.object({ dry_run: z.enum(['true', 'false']).optional().describe('Preview only') }),
      body: z.object({ name: z.string().describe('Name'), count: z.number().int().default(3), tags: z.array(z.string()).optional(), note: z.string().nullable().optional() }),
    }))
    expect(endpoint).toMatchObject({ method: 'POST', path: '/api/v1/things/{id}', label: 'Make a thing', permission: 'things.make' })
    expect(endpoint.description).toContain('Requires things.make')
    expect(endpoint.params).toEqual([
      { name: 'id', type: 'path', required: true },
      { name: 'dry_run', type: 'query', placeholder: 'true', description: 'Preview only', options: ['true', 'false'] },
      { name: 'name', type: 'body', required: true, description: 'Name' },
      { name: 'count', type: 'body', placeholder: '3' },
      { name: 'tags', type: 'body', placeholder: '[]' },
      { name: 'note', type: 'body' },
    ])
  })

  it('skips public endpoints and groups by first tag in registry order', () => {
    const groups = buildExplorerGroups(API_ENDPOINTS)
    expect(groups.flatMap((g) => g.endpoints).some((e) => e.path === '/api/v1/openapi.json')).toBe(false)
    expect(new Set(groups.map((g) => g.label)).size).toBe(groups.length)
  })
})
