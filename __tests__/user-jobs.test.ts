/**
 * Background jobs without a database: async API variants (`?async=true` /
 * `Prefer: respond-async` → 202 + job, the same handler as the sync route),
 * the job-kind registry (every kind the UI starts exists; every async
 * endpoint has its kind), permissions per kind, the set-based bulk delete,
 * the browser-facing job view and the download response.
 * (Lifecycle, RLS and download authorisation: user-jobs-db.test.ts.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api-auth')>()), validateApiKey: vi.fn() }))
vi.mock('@/lib/user-jobs/runner', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/user-jobs/runner')>()), enqueueUserJob: vi.fn() }))
vi.mock('@/lib/services/config', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/services/config')>()), exportConfig: vi.fn(async () => ({ format_version: 1, files: [], skipped: [] })), applyConfig: vi.fn(async () => ({ dry_run: true })) }))
vi.mock('@/lib/deletion-queue', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/deletion-queue')>()), kickDeletionProcessor: vi.fn() }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/agent-references', () => ({ deactivateWorkflowsReferencingAgent: vi.fn(async () => []) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { enqueueUserJob } from '@/lib/user-jobs/runner'
import { exportConfig } from '@/lib/services/config'
import { GET as exportRoute } from '@/app/api/v1/config/export/route'
import { POST as applyRoute } from '@/app/api/v1/config/apply/route'
import { GET as listJobsRoute } from '@/app/api/v1/jobs/route'
import { wantsAsync } from '@/lib/api/route'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { buildOpenApiDocument } from '@/lib/api-schemas/openapi'
import { JOB_KINDS, getJobKind, isUiJobKind } from '@/lib/user-jobs/kinds'
import { API_JOB_ENDPOINTS, apiJobKind } from '@/lib/user-jobs/kinds/api'
import { toJobView } from '@/lib/user-jobs/view'
import type { UserJobRow } from '@/lib/user-jobs/define'
import { contentDisposition, jobDownloadResponse } from '@/lib/user-jobs/download'
import { bulkQueueDeletion } from '@/lib/services/bulk-delete'
import { ServiceError, type ServiceContext } from '@/lib/services/context'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

const mockedValidate = vi.mocked(validateApiKey)
const mockedEnqueue = vi.mocked(enqueueUserJob)

function authAs(permissions: string[] = ['settings.view', 'workflows.view']) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'user', createdBy: 'u1', actingUserId: 'u1',
    scopes: { workflow_ids: [], table_ids: [] }, permissions, supabase: {} as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}

const fakeJob = { id: '11111111-1111-4111-8111-111111111111', status: 'queued', kind: 'api.exportconfig', title: 'x' }

beforeEach(() => {
  vi.clearAllMocks()
  mockedEnqueue.mockResolvedValue(fakeJob as any)
})

describe('async API variants', () => {
  it('wantsAsync: ?async=true or Prefer: respond-async', () => {
    expect(wantsAsync(new Request('https://a.test/x?async=true'))).toBe(true)
    expect(wantsAsync(new Request('https://a.test/x', { headers: { Prefer: 'return=minimal, respond-async' } }))).toBe(true)
    expect(wantsAsync(new Request('https://a.test/x?async=false'))).toBe(false)
    expect(wantsAsync(new Request('https://a.test/x'))).toBe(false)
  })

  it('GET /config/export?async=true → 202 with the job; the job kind gets the validated input and the caller\'s context', async () => {
    authAs()
    const response = await exportRoute(new NextRequest('https://app.test/api/v1/config/export?async=true&ids=a,b&with_dependencies=true', { headers: { authorization: 'Bearer ut_x' } }))
    expect(response.status).toBe(202)
    expect(response.headers.get('location')).toBe(`/api/v1/jobs/${fakeJob.id}`)
    expect(response.headers.get('preference-applied')).toBe('respond-async')
    expect(await response.json()).toEqual({ success: true, data: { job: fakeJob } })
    expect(exportConfig).not.toHaveBeenCalled()
    const [ctx, kind, params, options] = mockedEnqueue.mock.calls[0]
    expect(kind).toBe('api.exportconfig')
    expect(params).toEqual({ params: {}, query: { ids: 'a,b', with_dependencies: 'true' } })
    expect(ctx).toMatchObject({ tenantId: 'tenant-a', actorId: 'u1', authKind: 'api_key', credentialId: 'key-1' })
    expect(options).toEqual({ idempotencyKey: null })
  })

  it('without the flag the request runs inline as before', async () => {
    authAs()
    const response = await exportRoute(new NextRequest('https://app.test/api/v1/config/export?ids=a', { headers: { authorization: 'Bearer ut_x' } }))
    expect(response.status).toBe(200)
    expect(mockedEnqueue).not.toHaveBeenCalled()
    expect(exportConfig).toHaveBeenCalledOnce()
  })

  it('Prefer: respond-async on a POST; large bodies become the job input; Idempotency-Key is passed on', async () => {
    authAs()
    const files = Array.from({ length: 40 }, (_, i) => ({ path: `workflows/w${i}.json`, content: 'x'.repeat(2000) }))
    const response = await applyRoute(new NextRequest('https://app.test/api/v1/config/apply', {
      method: 'POST', body: JSON.stringify({ files }),
      headers: { authorization: 'Bearer ut_x', 'content-type': 'application/json', prefer: 'respond-async', 'idempotency-key': 'apply-1' },
    }))
    expect(response.status).toBe(202)
    const [, kind, params, options] = mockedEnqueue.mock.calls[0] as any
    expect(kind).toBe('api.applyconfig')
    expect(params).toEqual({ params: {}, query: {}, body_in_input: true })
    expect(JSON.parse(new TextDecoder().decode(options.input)).files).toHaveLength(40)
    expect(options.idempotencyKey).toBe('apply-1')
  })

  it('endpoints without an async variant ignore the flag', async () => {
    authAs()
    const listJobs = vi.spyOn(await import('@/lib/services/user-jobs'), 'listJobs').mockResolvedValue({ jobs: [] })
    const response = await listJobsRoute(new NextRequest('https://app.test/api/v1/jobs?async=true', { headers: { authorization: 'Bearer ut_x' } }))
    expect(response.status).toBe(200)
    expect(mockedEnqueue).not.toHaveBeenCalled()
    listJobs.mockRestore()
  })

  it('every async endpoint has its job kind (same handler) and is marked in the OpenAPI document', () => {
    const asyncOps = API_ENDPOINTS.filter((e) => e.async).map((e) => e.operationId).sort()
    expect(asyncOps).toEqual(API_JOB_ENDPOINTS.map((e) => e.endpoint.operationId).sort())
    for (const op of asyncOps) expect(getJobKind(apiJobKind(op)), op).toBeDefined()
    const doc = buildOpenApiDocument() as any
    const exportOp = doc.paths['/config/export'].get
    expect(exportOp['x-usertasks-async']).toBe(true)
    expect(exportOp.responses['202']).toBeDefined()
    expect(exportOp.parameters.map((p: any) => p.name)).toEqual(expect.arrayContaining(['async', 'Prefer']))
    expect(doc.paths['/jobs/{id}/download'].get['x-usertasks-download']).toBe(true)
    expect(doc.paths['/jobs'].get['x-usertasks-async']).toBeUndefined()
  })
})

describe('job kinds', () => {
  it('names are valid and unique; API kinds are not startable from the browser', () => {
    const names = JOB_KINDS.map((k) => k.kind)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_.-]{1,63}$/)
    expect(isUiJobKind('config.export')).toBe(true)
    expect(isUiJobKind('api.exportconfig')).toBe(false)
    expect(isUiJobKind('nope')).toBe(false)
  })

  it('every kind the UI starts exists (components, app pages)', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry)) files.push(full)
      }
    }
    walk(path.join(process.cwd(), 'components'))
    walk(path.join(process.cwd(), 'app'))
    const started = new Set<string>()
    const deleteTypes = new Set<string>()
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/(?:jobs(?:Api)?\.start|runInlineJob\(\s*jobs(?:Api)?)\s*\(?,?\s*['"]([a-z][a-z0-9_.-]+)['"]/g)) started.add(m[1])
      for (const m of text.matchAll(/bulkDeleteWithJob\(\s*jobs,\s*['"]([a-z_]+)['"]/g)) deleteTypes.add(m[1])
    }
    expect(started.size).toBeGreaterThanOrEqual(15)
    for (const kind of started) expect(getJobKind(kind), kind).toBeDefined()
    const bulk = getJobKind('bulk.delete')!
    for (const type of deleteTypes) expect(bulk.params.safeParse({ type, ids: ['11111111-1111-4111-8111-111111111111'] }).success, type).toBe(true)
    expect([...deleteTypes].sort()).toEqual(['agent', 'api_key', 'data_row', 'data_table', 'decision_table', 'reference', 'report', 'retention_policy', 'workflow_activity'])
  })

  const ctxWith = (permissions: string[]): ServiceContext => ({ supabase: {} as any, tenantId: 't', actorId: 'u', permissions: new Set(permissions), authKind: 'session', source: 'ui' })
  const authorize = (kind: string, params: unknown, permissions: string[]) => {
    const def = getJobKind(kind)!
    return Promise.resolve().then(() => def.authorize(ctxWith(permissions), def.params.parse(params)))
  }

  it('each kind checks the permission its synchronous action did', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const cases: Array<[string, unknown, string]> = [
      ['bulk.delete', { type: 'workflow', ids: [id] }, 'workflows.delete'],
      ['bulk.delete', { type: 'data_row', ids: [id] }, 'data.manage_rows'],
      ['bulk.delete', { type: 'agent', ids: [id] }, 'agents.delete'],
      ['bulk.delete', { type: 'report', ids: [id] }, 'reports.delete'],
      ['bulk.delete', { type: 'retention_policy', ids: [id] }, 'team.change_roles'],
      ['bulk.delete', { type: 'workflow_activity', ids: [id] }, 'extensibility.delete'],
      ['bulk.delete', { type: 'reference', ids: [id] }, 'integrations.manage_references'],
      ['bulk.delete', { type: 'api_key', ids: [id] }, 'settings.manage_api_keys'],
      ['workflows.set_active', { ids: [id], active: true }, 'workflows.activate'],
      ['report.export', {}, 'reports.view'],
      ['package.build', { package_id: id }, 'packages.manage'],
      ['package.download', { package_id: id, version: '1.0.0' }, 'packages.view'],
      ['package.install', {}, 'packages.install'],
      ['package.uninstall', { install_id: id }, 'packages.install'],
      ['package.history_csv', {}, 'packages.view'],
      ['roles.bulk', { action: 'assign', role_id: id, user_ids: [id] }, 'team.change_roles'],
      ['references.add_tag', { ids: [id], tag: 'x' }, 'integrations.manage_references'],
      ['connectors.regenerate_references', { connector_id: id }, 'integrations.manage_references'],
      ['workflow_instances.migrate', { workflowId: id, toVersionId: id }, 'workflows.manage_runs'],
      ['workflow_queue.bulk', { action: 'pause', items: [{ job_id: 'q1', run_id: id }] }, 'workflows.activate'],
      ['sync.watch', { source: 'github_sync', run_id: id }, 'settings.edit'],
      ['directory_sync.run', { provider: 'ldap' }, 'settings.edit'],
      ['object_permissions.bulk_set', { objectType: 'workflow', objectIds: [id], roleId: id, canView: true, canEdit: false, canDelete: false, canExecute: false }, 'team.change_roles'],
    ]
    for (const [kind, params, permission] of cases) {
      await expect(authorize(kind, params, []), `${kind} without ${permission}`).rejects.toThrow(permission)
      await expect(authorize(kind, params, [permission]), `${kind} with ${permission}`).resolves.toBeUndefined()
    }
  })

  it('rejects malformed params (ids must be uuids, bounded lists)', () => {
    const bulk = getJobKind('bulk.delete')!
    expect(bulk.params.safeParse({ type: 'workflow', ids: ['not-a-uuid'] }).success).toBe(false)
    expect(bulk.params.safeParse({ type: 'users', ids: ['11111111-1111-4111-8111-111111111111'] }).success).toBe(false)
    expect(bulk.params.safeParse({ type: 'workflow', ids: [] }).success).toBe(false)
    expect(getJobKind('config.export')!.params.parse({ ids: ['11111111-1111-4111-8111-111111111111'] })).toEqual({ ids: ['11111111-1111-4111-8111-111111111111'], name: 'export', with_dependencies: false, include_rows: false })
  })
})

describe('bulk delete service (set-based)', () => {
  const T = 'tenant-a'
  const ctx = (fake: ReturnType<typeof createFakeSupabase>, permissions: string[] | null = null, actorId = 'u1'): ServiceContext =>
    ({ supabase: fake.client as any, tenantId: T, actorId, permissions: permissions ? new Set(permissions) : null, authKind: 'job', source: 'job', jobId: 'job-1' })

  it('queues found items in one insert, audits in one insert, ignores other tenants', async () => {
    const fake = createFakeSupabase({
      workflows: [
        ...Array.from({ length: 150 }, (_, i) => ({ id: `w${i}`, tenant_id: T, name: `W${i}` })),
        { id: 'foreign', tenant_id: 'tenant-b', name: 'Foreign' },
      ],
      deletion_queue: [], object_audit_log: [], tenant_connectors: [],
    })
    const ids = [...Array.from({ length: 150 }, (_, i) => `w${i}`), 'foreign']
    const progress: number[] = []
    const result = await bulkQueueDeletion(ctx(fake, ['workflows.delete']), 'workflow', ids, { onProgress: (done) => { progress.push(done) } })
    expect(result).toEqual({ queued: 150, missing: 1, blocked: [] })
    expect(fake.tables.deletion_queue).toHaveLength(150)
    expect(fake.tables.deletion_queue.every((row: any) => row.tenant_id === T && row.target_type === 'workflow' && row.created_by === 'u1')).toBe(true)
    expect(fake.tables.deletion_queue.some((row: any) => row.target_id === 'foreign')).toBe(false)
    expect(fake.count('deletion_queue', 'insert')).toBe(2) // two batches of ≤100, not 150 inserts
    expect(fake.count('object_audit_log', 'insert')).toBe(2)
    expect((fake.tables.object_audit_log[0] as any).metadata).toMatchObject({ via: 'job', bulk: true, job_id: 'job-1' })
    expect(progress).toEqual([100, 151])
  })

  it('needs the type\'s delete permission', async () => {
    const fake = createFakeSupabase({ agents: [], deletion_queue: [] })
    await expect(bulkQueueDeletion(ctx(fake, ['agents.view']), 'agent', ['a1'])).rejects.toBeInstanceOf(ServiceError)
    expect(fake.count('deletion_queue', 'insert')).toBe(0)
  })

  it('reports: only the caller\'s own (as the delete RLS policy)', async () => {
    const fake = createFakeSupabase({
      reports: [{ id: 'r1', tenant_id: T, name: 'Mine', created_by: 'u1' }, { id: 'r2', tenant_id: T, name: 'Theirs', created_by: 'u2' }],
      deletion_queue: [], object_audit_log: [], tenant_connectors: [],
    })
    expect(await bulkQueueDeletion(ctx(fake, ['reports.delete']), 'report', ['r1', 'r2'])).toEqual({ queued: 1, missing: 1, blocked: [] })
    expect(fake.tables.deletion_queue.map((row: any) => row.target_id)).toEqual(['r1'])
  })

  it('retention policies still in use are kept (and all in use is a conflict)', async () => {
    const fake = createFakeSupabase({
      retention_policies: [{ id: 'p1', tenant_id: T, name: 'Used' }, { id: 'p2', tenant_id: T, name: 'Free' }],
      custom_tables: [{ id: 't1', tenant_id: T, retention_policy_id: 'p1' }], custom_table_rows: [], roles: [],
      deletion_queue: [], tenant_connectors: [],
    })
    expect(await bulkQueueDeletion(ctx(fake, ['team.change_roles']), 'retention_policy', ['p1', 'p2'])).toEqual({ queued: 1, missing: 0, blocked: ['p1'] })
    await expect(bulkQueueDeletion(ctx(fake, ['team.change_roles']), 'retention_policy', ['p1'])).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('job view and download response', () => {
  const base: UserJobRow = {
    id: 'j1', tenant_id: 't', user_id: 'u', kind: 'config.export', title: 'Export', params: { ids: ['a'] }, origin: { source: 'ui', auth_kind: 'session' },
    status: 'succeeded', progress: 100, message: null, error: null, checkpoint: { secret: 'state' }, attempts: 1, max_attempts: 3, run_after: '', lease_owner: null,
    lease_expires_at: null, heartbeat_at: null, cancel_requested_at: null, idempotency_key: null, created_at: '', updated_at: '', started_at: '', finished_at: '',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    result: { file: { ref: 'storage://job-results/t/j1/export.json', filename: 'export.json', content_type: 'application/json', size: 10 }, summary: '1 item' },
  }

  it('never exposes storage refs, params, origin or checkpoints', () => {
    const view = toJobView(base)
    expect(view).toMatchObject({ downloadable: true, download_url: '/api/jobs/j1/download', result: { file: { filename: 'export.json', size: 10 }, summary: '1 item' } })
    const text = JSON.stringify(view)
    for (const hidden of ['storage://', 'secret', 'origin', 'params', 'lease']) expect(text).not.toContain(hidden)
  })

  it('expired or unfinished jobs are not downloadable; active ones are cancellable, finished failures retryable', () => {
    expect(toJobView({ ...base, expires_at: new Date(Date.now() - 1000).toISOString() }).downloadable).toBe(false)
    expect(toJobView({ ...base, status: 'running' })).toMatchObject({ downloadable: false, cancellable: true, retryable: false, expires_at: null })
    expect(toJobView({ ...base, status: 'running', cancel_requested_at: 'x' }).cancellable).toBe(false)
    expect(toJobView({ ...base, status: 'failed', result: null })).toMatchObject({ retryable: true, downloadable: false })
  })

  it('downloads are attachments, never cached, sandboxed', () => {
    const response = jobDownloadResponse({ body: new Blob(['x']).stream(), filename: 'résumé "x".html', contentType: 'text/html', size: 1 })
    expect(response.headers.get('content-disposition')).toBe(contentDisposition('résumé "x".html'))
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="r_sum_ _x_.html"; filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22x%22.html$/)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
  })
})
