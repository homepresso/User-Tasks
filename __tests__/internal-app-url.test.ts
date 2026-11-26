/**
 * Self-calls (queue / deletion / user-job kicks) go to INTERNAL_APP_URL, not
 * the public APP_URL. In Docker the public URL is the host's port
 * (http://localhost:59610) or an HTTPS name and doesn't answer from inside
 * the container: every kick failed silently and queued workflows waited up
 * to a minute for the worker's tick. docker-compose.yml sets
 * INTERNAL_APP_URL=http://app:3000 for the app, migrate and worker.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/processing/handoff', () => ({ processingHandoff: async () => 'inline', notifyProcessing: async () => undefined }))

const ENV = ['INTERNAL_APP_URL', 'APP_URL', 'NEXT_PUBLIC_APP_URL'] as const
const saved: Record<string, string | undefined> = {}

describe('internalAppUrl', () => {
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k]
    vi.resetModules()
  })
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.unstubAllGlobals()
  })

  it('prefers INTERNAL_APP_URL (trailing slash trimmed), else the public app URL', async () => {
    process.env.APP_URL = 'http://localhost:59610'
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:59610'
    process.env.INTERNAL_APP_URL = 'http://app:3000/'
    const { internalAppUrl, appUrlOrLocalhost } = await import('@/lib/config/bootstrap')
    expect(internalAppUrl()).toBe('http://app:3000')
    expect(appUrlOrLocalhost()).toBe('http://localhost:59610')
    process.env.INTERNAL_APP_URL = '  '
    expect(internalAppUrl()).toBe('http://localhost:59610')
    delete process.env.INTERNAL_APP_URL
    expect(internalAppUrl()).toBe('http://localhost:59610')
  })

  it('the workflow queue kick is sent to the internal origin', async () => {
    process.env.APP_URL = 'http://localhost:59610'
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:59610'
    process.env.INTERNAL_APP_URL = 'http://app:3000'
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return new Response('{}') }))
    const { coalescedKick, resetQueueKickState } = await import('@/lib/process-queue')
    resetQueueKickState()
    await coalescedKick()
    expect(calls).toEqual(['http://app:3000/api/workflows/process'])
  })

  it('docker-compose.yml gives every app-image container INTERNAL_APP_URL=http://app:3000 by default', () => {
    const compose = parse(readFileSync(path.resolve(__dirname, '..', 'docker-compose.yml'), 'utf8'), { merge: true })
    for (const svc of ['app', 'migrate', 'worker']) {
      expect(compose.services[svc].environment?.INTERNAL_APP_URL, svc).toBe('${INTERNAL_APP_URL:-http://app:3000}')
    }
  })
})
