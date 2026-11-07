/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_PROVIDER_BY_ID } from '@/lib/media/catalog'
import type { MediaNodeContext } from '@/lib/media/handlers'

const resumes: Array<{ tenantId: string; eventId: string; variables: Record<string, unknown> }> = []
vi.mock('@/lib/workflow-resume-queue', () => ({
  enqueueResume: vi.fn(async (p: any) => { resumes.push({ tenantId: p.tenantId, eventId: p.eventId, variables: p.variables }); return {} }),
}))
vi.mock('@/lib/media/ffmpeg', async (orig) => ({ ...(await orig<typeof import('@/lib/media/ffmpeg')>()), ffmpegAvailable: async () => false }))

const { runMediaJob, enqueueMediaJob, isMediaManagedEvent, MEDIA_WAIT_EVENT_PREFIX, processMediaJobBatch } = await import('@/lib/media/jobs')

function fakeDb(runStatus = 'waiting_for_event') {
  const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const db = {
    updates, inserts,
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let patch: Record<string, unknown> | null = null
      const q: any = {
        update(p: Record<string, unknown>) { patch = p; return q },
        insert(row: Record<string, unknown>) { inserts.push({ table, row }); return Promise.resolve({ error: null }) },
        select() { return q },
        eq(c: string, v: unknown) { filters.push([c, v]); return q },
        lt() { return q },
        limit() { return Promise.resolve({ data: [] }) },
        maybeSingle: async () => ({ data: table === 'workflow_runs' ? { status: runStatus } : null }),
        then(resolve: (v: unknown) => void) { if (patch) updates.push({ table, patch, filters }); resolve({ error: null }) },
      }
      return q
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }
  return db
}

const audio = { name: 'call.mp3', mime_type: 'audio/mpeg', bytes: new Uint8Array(64) }
const transcript = { text: 'Hello there', segments: [{ id: 0, start: 0, end: 2, text: 'Hello there' }], provider: 'deepgram' as const, duration: 2 }

function deps(provider: Record<string, unknown>): MediaNodeContext['deps'] {
  return {
    credentials: { provider: MEDIA_PROVIDER_BY_ID.deepgram, credentials: { provider: 'deepgram', integrationId: 'i', baseUrl: 'https://x.test', apiKey: 'k', extra: {} } },
    provider: { id: 'deepgram', label: 'Deepgram', capabilities: ['transcribe'], ...provider } as never,
    resolveFile: async () => ({ ...audio, size: audio.bytes.byteLength, source: 'storage' as const }),
    store: async (bytes, name, mime) => ({ _file: true, id: 'f', name, size: bytes.byteLength, mime_type: mime, content_type: mime, url: '/f', path: 'p', storage_ref: 'storage://task-files/p', uploaded_by: null, uploaded_at: '', checksum_sha256: '' }),
  }
}

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1', tenant_id: 'tenant-a', run_id: 'run-1', event_id: `${MEDIA_WAIT_EVENT_PREFIX}abc`, node_id: 'node-1', node_type: 'media_transcribe',
  output_prefix: 'transcribe_call', config: { integration_id: 'i', source: { name: 'call.mp3', storage_ref: 'storage://task-files/t/x.mp3' }, formats: ['srt'] }, state: {},
  deadline_at: new Date(Date.now() + 60_000).toISOString(), ...over,
})

beforeEach(() => { resumes.length = 0 })

describe('media jobs', () => {
  it('event ids are recognisable and protected', () => {
    expect(isMediaManagedEvent(`${MEDIA_WAIT_EVENT_PREFIX}x`)).toBe(true)
    expect(isMediaManagedEvent('agentwait_x')).toBe(false)
    expect(isMediaManagedEvent(null)).toBe(false)
  })

  it('enqueue stores the resolved config and a deadline, never media bytes', async () => {
    const db = fakeDb()
    const eventId = await enqueueMediaJob({ supabase: db as never, tenantId: 't', runId: 'r', nodeId: 'n', nodeType: 'media_transcribe', outputPrefix: 'p', config: { source: { storage_ref: 'storage://x' } }, start: false })
    expect(eventId.startsWith(MEDIA_WAIT_EVENT_PREFIX)).toBe(true)
    const row = db.inserts[0].row
    expect(row).toMatchObject({ tenant_id: 't', run_id: 'r', event_id: eventId, node_type: 'media_transcribe', output_prefix: 'p', state: {} })
    expect(new Date(String(row.deadline_at)).getTime()).toBeGreaterThan(Date.now())
  })

  it('a finished job resumes the run with the step variables (prefixed too) and its output', async () => {
    const db = fakeDb()
    const r = await runMediaJob(db as never, job(), { deps: deps({ transcribe: async () => transcript }) })
    expect(r.status).toBe('completed')
    expect(db.updates.at(-1)!.patch).toMatchObject({ status: 'completed', locked_by: null })
    expect(db.updates.at(-1)!.filters).toEqual([['id', 'job-1'], ['tenant_id', 'tenant-a']])
    expect(resumes).toHaveLength(1)
    expect(resumes[0].eventId).toBe(`${MEDIA_WAIT_EVENT_PREFIX}abc`)
    expect(resumes[0].variables).toMatchObject({ transcript_text: 'Hello there', _media_node_output: expect.objectContaining({ mode: 'background', segments: 1 }) })
    expect((resumes[0].variables.transcript_srt as any).name).toBe('call-transcript.srt')
  })

  it('a provider still working → back to pending with the next poll time', async () => {
    const db = fakeDb()
    const asyncJob = { async: true, provider: 'deepgram', operation: 'transcribe', job: { id: 'p1' }, pollAfterMs: 1000 }
    const r = await runMediaJob(db as never, job({ state: { asyncJob } }), { deps: deps({ poll: async () => ({ done: false, pollAfterMs: 20_000 }) }), pollBudgetMs: 50 })
    expect(r.status).toBe('pending')
    const patch = db.updates.at(-1)!.patch
    expect(patch).toMatchObject({ status: 'pending', attempts: 0, state: { asyncJob } })
    expect(new Date(String(patch.run_after)).getTime()).toBeGreaterThan(Date.now() + 1_000)
    expect(resumes).toHaveLength(0)
  })

  it('a failure fails the step (the run resumes with the error)', async () => {
    const db = fakeDb()
    const r = await runMediaJob(db as never, job(), { deps: deps({ transcribe: async () => { throw new Error('Deepgram: 401 invalid credentials') } }) })
    expect(r.status).toBe('failed')
    expect(db.updates.at(-1)!.patch).toMatchObject({ status: 'failed', error: 'Deepgram: 401 invalid credentials' })
    expect(resumes[0].variables).toEqual({ _media_node_error: 'Deepgram: 401 invalid credentials' })
  })

  it('past its deadline → fails; run no longer waiting → cancelled without resuming', async () => {
    const late = fakeDb()
    expect((await runMediaJob(late as never, job({ deadline_at: new Date(Date.now() - 1000).toISOString() }))).status).toBe('failed')
    expect(String(resumes[0].variables._media_node_error)).toMatch(/MEDIA_JOB_TIMEOUT_SECONDS/)
    resumes.length = 0
    const gone = fakeDb('cancelled')
    expect((await runMediaJob(gone as never, job(), { deps: deps({ transcribe: async () => transcript }) })).status).toBe('cancelled')
    expect(gone.updates.at(-1)!.patch).toMatchObject({ status: 'cancelled' })
    expect(resumes).toHaveLength(0)
  })

  it('the batch claims jobs through the RPC and stops when none are due', async () => {
    const db = fakeDb()
    const out = await processMediaJobBatch({ supabase: db as never, batchSize: 3 })
    expect(out.processed).toBe(0)
    expect(db.rpc).toHaveBeenCalledWith('claim_next_media_job', { p_worker_id: expect.stringMatching(/^media-worker-/) })
  })
})
