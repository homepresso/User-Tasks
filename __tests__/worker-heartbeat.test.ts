/**
 * Worker heartbeat (ops QA 2026-11): the worker container had no healthcheck,
 * so a hung loop still showed "Up". The worker writes a heartbeat file every
 * minute; docker-compose.yml's worker healthcheck checks its age.
 */
import { mkdtempSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { heartbeatFresh, HEARTBEAT_MAX_AGE_MS, writeHeartbeat } from '@/lib/scheduler/heartbeat'

describe('worker heartbeat', () => {
  it('fresh after a write, stale after the max age, false when missing', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hb-')), 'beat')
    expect(heartbeatFresh(file)).toBe(false)
    writeHeartbeat(file)
    expect(heartbeatFresh(file)).toBe(true)
    const old = (Date.now() - HEARTBEAT_MAX_AGE_MS - 5_000) / 1000
    utimesSync(file, old, old)
    expect(heartbeatFresh(file)).toBe(false)
  })

  it('docker-compose.yml checks the same file and age for the worker', () => {
    const compose = parse(readFileSync(path.resolve(__dirname, '..', 'docker-compose.yml'), 'utf8'), { merge: true })
    const test = compose.services.worker.healthcheck.test.join(' ')
    expect(test).toContain('/tmp/usertasks-worker-heartbeat')
    expect(test).toContain(String(HEARTBEAT_MAX_AGE_MS))
  })
})
