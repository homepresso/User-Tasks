import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { harness, type Recorded } from './helpers'

/**
 * Background jobs from the CLI: operations with an async variant run as a
 * job and wait for its result (progress on stderr) — the same output as the
 * synchronous call; --no-wait prints the job; older servers that answer
 * inline still work; `jobs wait` / `jobs download`.
 */

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }
const JOB = '7b0c0000-0000-4000-8000-000000000001'
const job = (status: string, extra: Record<string, unknown> = {}) => ({ id: JOB, kind: 'api.bulkdeletereferences', title: 'Bulk delete', status, progress: status === 'succeeded' ? 100 : 40, message: status === 'running' ? 'half way' : null, error: null, result: null, ...extra })

function asyncServer(final: string = 'succeeded') {
  let polls = 0
  return (request: Recorded) => {
    const path = request.url.pathname
    if (path === '/api/v1/references/bulk-delete') {
      if (request.headers.Prefer !== 'respond-async') return { body: { success: true, data: { deleted: 1, ids: ['r1'] } } }
      return { status: 202, body: { success: true, data: { job: job('queued') } } }
    }
    if (path === `/api/v1/jobs/${JOB}`) {
      polls++
      return { body: { success: true, data: { job: polls < 2 ? job('running') : job(final, final === 'failed' ? { error: 'boom' } : {}) } } }
    }
    if (path === `/api/v1/jobs/${JOB}/result`) return { body: { success: true, data: { deleted: 2, ids: ['r1', 'r2'] } } }
    return { status: 404, body: { success: false, error: 'nope' } }
  }
}

describe('async operations in the CLI', () => {
  it('waits for the job by default and prints the synchronous result shape', async () => {
    const h = harness({ env, responder: asyncServer() })
    const code = await h.run('references', 'bulk-delete', '--set', 'ids:=["r1","r2"]', '--yes', '-o', 'json')
    expect(code).toBe(0)
    expect(h.requests[0].headers.Prefer).toBe('respond-async')
    expect(h.requests.map((r) => r.url.pathname)).toEqual([
      '/api/v1/references/bulk-delete', `/api/v1/jobs/${JOB}`, `/api/v1/jobs/${JOB}`, `/api/v1/jobs/${JOB}/result`,
    ])
    expect(JSON.parse(h.stdout())).toEqual({ deleted: 2, ids: ['r1', 'r2'] })
    expect(h.stderr()).toMatch(/job running 40% — half way/)
  }, 15_000)

  it('--no-wait prints the job', async () => {
    const h = harness({ env, responder: asyncServer() })
    expect(await h.run('references', 'bulk-delete', '--set', 'ids:=["r1"]', '--yes', '--no-wait', '-o', 'json')).toBe(0)
    expect(h.requests).toHaveLength(1)
    expect(JSON.parse(h.stdout()).job).toMatchObject({ id: JOB, status: 'queued' })
  })

  it('a failed job exits non-zero with its error', async () => {
    const h = harness({ env, responder: asyncServer('failed') })
    expect(await h.run('references', 'bulk-delete', '--set', 'ids:=["r1"]', '--yes')).not.toBe(0)
    expect(h.stderr()).toMatch(/failed: boom/)
  }, 15_000)

  it('a server without async support answers inline: same output', async () => {
    const h = harness({ env, responder: () => ({ body: { success: true, data: { deleted: 1, ids: ['r1'] } } }) })
    expect(await h.run('references', 'bulk-delete', '--set', 'ids:=["r1"]', '--yes', '-o', 'json')).toBe(0)
    expect(h.requests).toHaveLength(1)
    expect(JSON.parse(h.stdout())).toEqual({ deleted: 1, ids: ['r1'] })
  })

  it('jobs wait and jobs download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ut-jobs-'))
    const target = join(dir, 'out.json')
    const h = harness({
      env,
      responder: (request) => {
        if (request.url.pathname === `/api/v1/jobs/${JOB}`) return { body: { success: true, data: { job: job('succeeded') } } }
        if (request.url.pathname === `/api/v1/jobs/${JOB}/download`) return { body: { hello: 'file' }, headers: { 'Content-Disposition': `attachment; filename="export.json"; filename*=UTF-8''export.json` } }
        return { status: 404, body: { success: false, error: 'nope' } }
      },
    })
    expect(await h.run('jobs', 'wait', JOB, '-o', 'json')).toBe(0)
    expect(JSON.parse(h.stdout()).job.status).toBe('succeeded')
    expect(await h.run('jobs', 'download', JOB, '--out', target)).toBe(0)
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ hello: 'file' })
  })
})
