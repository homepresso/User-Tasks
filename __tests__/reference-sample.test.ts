import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import { EgressBlockedError } from '@/lib/egress-guard'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const TENANT = 'cccccccc-0000-4000-8000-000000000001'
const S3 = {
  contents: [{ key: 'a.pdf', size: 10, last_modified: '2021-06-02T16:44:29.000Z', etag: 'x', storage_class: 'STANDARD' }],
  common_prefixes: [], key_count: 1, is_truncated: false, prefix: '', next_continuation_token: null,
}

let refs: Record<string, any>
let updates: Array<{ id: unknown; tenant: unknown; patch: any }>
let selects: Array<[string, unknown][]>

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let patch: any = null
      const api: any = {
        select() { return api },
        update(p: any) { patch = p; return api },
        eq(f: string, v: unknown) { filters.push([f, v]); return api },
        maybeSingle() { return api },
        then(resolve: (v: unknown) => unknown) {
          const get = (f: string) => filters.find(([k]) => k === f)?.[1]
          if (table !== 'integration_references') return Promise.resolve({ data: null, error: null }).then(resolve)
          if (patch) {
            updates.push({ id: get('id'), tenant: get('tenant_id'), patch })
            return Promise.resolve({ error: null }).then(resolve)
          }
          selects.push([...filters])
          const row = refs[String(get('id'))]
          return Promise.resolve({ data: row && row.tenant_id === get('tenant_id') ? row : null, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), syncChange: () => undefined, audit: () => undefined }))

const { loadReferenceSample, referenceSampleDeps } = await import('@/lib/services/references')

const ctx = (perms: string[] | null): ServiceContext => ({ supabase: fakeDb() as any, tenantId: TENANT, actorId: 'user-1', permissions: perms ? new Set(perms) : null, authKind: 'session', source: 'ui' } as any)
let calls: any[]
let reply: any

beforeEach(() => {
  refs = {
    'ref-s3': {
      id: 'ref-s3', tenant_id: TENANT, name: 'S3: List Objects',
      outputs: [{ name: 'contents', path: '', type: 'array' }, { name: 'common_prefixes', path: '', type: 'array' }],
      request_config: { method: 'GET', response_schema: { version: 1, source: 'connector', root: { type: 'object', fields: [{ name: 'contents', type: 'array' }, { name: 'common_prefixes', type: 'array' }] } } },
    },
    'ref-other-tenant': { id: 'ref-other-tenant', tenant_id: 'someone-else', name: 'x', request_config: {} },
  }
  updates = []
  selects = []
  calls = []
  reply = { status: 200, data: S3, headers: {} }
  referenceSampleDeps.execute = (async (opts: any) => { calls.push(opts); if (reply instanceof Error) throw reply; return reply }) as any
})

describe('Load sample: the test-call permission path', () => {
  it('needs integrations.test (or integrations.edit) and makes no call without it', async () => {
    await expect(loadReferenceSample(ctx(['integrations.view', 'forms.edit']), 'ref-s3', {})).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toHaveLength(0)
    await expect(loadReferenceSample(ctx(['integrations.edit']), 'ref-s3', {})).resolves.toMatchObject({ saved: false })
  })

  it('runs only the caller\'s own tenant\'s references, through the executor with the tenant pinned', async () => {
    await expect(loadReferenceSample(ctx(['integrations.test']), 'ref-other-tenant', {})).rejects.toMatchObject({ code: 'not_found' })
    expect(calls).toHaveLength(0)
    await loadReferenceSample(ctx(['integrations.test']), 'ref-s3', { prefix: 'invoices/', max_keys: 5, 'bad name': 'x', nothing: null })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ referenceId: 'ref-s3', expectedTenantId: TENANT, inputValues: { prefix: 'invoices/', max_keys: '5' }, caller: { callerType: 'manual_test', callerId: 'user-1' } })
    expect(selects[0]).toContainEqual(['tenant_id', TENANT])
  })

  it('without manage_references: returns the merged model for the session and stores nothing', async () => {
    const result = await loadReferenceSample(ctx(['integrations.test']), 'ref-s3', {})
    expect(result.saved).toBe(false)
    expect(updates).toHaveLength(0)
    const contents = result.response_schema.root.fields!.find((f) => f.name === 'contents')!
    expect(contents.items?.fields?.map((f) => f.name)).toContain('last_modified')
  })

  it('with manage_references: merges into the stored model and saves it on the reference', async () => {
    const result = await loadReferenceSample(ctx(['integrations.test', 'integrations.manage_references']), 'ref-s3', {})
    expect(result.saved).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: 'ref-s3', tenant: TENANT })
    const stored = updates[0].patch.request_config
    expect(stored.method).toBe('GET')
    expect(stored.response_schema).toMatchObject({ source: 'connector', samples: 1 })
    expect(stored.response_schema.sample.contents).toHaveLength(1)
  })

  it('unwraps an executor envelope and refuses errors, empty bodies and blocked egress', async () => {
    reply = { status: 200, data: { status: 200, data: S3, headers: {} } }
    const ok = await loadReferenceSample(ctx(['integrations.test']), 'ref-s3', {})
    expect(ok.response_schema.root.fields!.map((f) => f.name)).toContain('contents')

    reply = { status: 403, data: { message: 'Access Denied' }, error_message: 'Access Denied' }
    await expect(loadReferenceSample(ctx(['integrations.test']), 'ref-s3', {})).rejects.toMatchObject({ code: 'validation_error', message: 'The API answered 403: Access Denied' })
    reply = { status: 200, data: null }
    await expect(loadReferenceSample(ctx(['integrations.test']), 'ref-s3', {})).rejects.toMatchObject({ code: 'validation_error' })
    reply = new EgressBlockedError('10.0.0.1', 'private address')
    await expect(loadReferenceSample(ctx(['integrations.test']), 'ref-s3', {})).rejects.toMatchObject({ code: 'validation_error' })
    expect(updates).toHaveLength(0)
  })
})
