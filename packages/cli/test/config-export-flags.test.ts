import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/exit-codes'
import { harness, ok } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }
const ID = '3fa8c21b-1234-4678-9abc-def012345678'
const tempDir = () => mkdtempSync(join(tmpdir(), 'usertasks-config-flags-'))
const emptyExport = () => ok({ format_version: 3, files: [{ path: 'manifest.json', content: '{}\n' }], skipped: [] })
const appliedPlan = () => ok({ dry_run: false, plan: { assets: [], summary: { create: 0, update: 0, unchanged: 0, error: 0 } }, warnings: [], result: { created: {}, updated: {}, errors: [], warnings: [] } })

function configDir() {
  const dir = tempDir()
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ format_version: 3, asset_type: 'integrations', id: ID, asset: { id: ID, name: 'ERP' } }))
  return dir
}

describe('usertasks config export flags', () => {
  it('sends ids, with_dependencies and include_rows query params', async () => {
    const h = harness({ env, responder: emptyExport })
    expect(await h.run('config', 'export', join(tempDir(), 'out'), '--ids', 'a, b,', '--with-dependencies', '--include-rows')).toBe(0)
    expect(h.requests).toHaveLength(1)
    const { url, method } = h.requests[0]
    expect(method).toBe('GET')
    expect(url.pathname).toBe('/api/v1/config/export')
    expect(Object.fromEntries(url.searchParams)).toEqual({ format: 'files', ids: 'a,b', with_dependencies: 'true', include_rows: 'true' })
  })

  it('omits the optional params when the flags are absent', async () => {
    const h = harness({ env, responder: emptyExport })
    expect(await h.run('config', 'export', join(tempDir(), 'out'))).toBe(0)
    expect(Object.fromEntries(h.requests[0].url.searchParams)).toEqual({ format: 'files' })
  })

  it('--include-rows works without --ids', async () => {
    const h = harness({ env, responder: emptyExport })
    expect(await h.run('config', 'export', join(tempDir(), 'out'), '--types', 'data_tables', '--include-rows')).toBe(0)
    expect(Object.fromEntries(h.requests[0].url.searchParams)).toEqual({ format: 'files', types: 'data_tables', include_rows: 'true' })
  })

  it('rejects --with-dependencies without --ids before any request', async () => {
    const h = harness({ env, responder: emptyExport })
    expect(await h.run('config', 'export', join(tempDir(), 'out'), '--with-dependencies')).toBe(EXIT.usage)
    expect(h.requests).toHaveLength(0)
    expect(h.stderr()).toContain('--with-dependencies needs --ids')
  })
})

describe('usertasks config apply --rows-mode', () => {
  it('sends rows_mode in the POST body', async () => {
    const h = harness({ env, responder: appliedPlan })
    expect(await h.run('config', 'apply', configDir(), '--rows-mode', 'replace')).toBe(0)
    expect(h.requests[0].method).toBe('POST')
    expect(h.requests[0].url.pathname).toBe('/api/v1/config/apply')
    expect(h.requests[0].body).toMatchObject({ dry_run: false, rows_mode: 'replace', files: [{ path: 'a.json' }] })
  })

  it('leaves rows_mode out by default', async () => {
    const h = harness({ env, responder: appliedPlan })
    expect(await h.run('config', 'apply', configDir())).toBe(0)
    expect(h.requests[0].body).not.toHaveProperty('rows_mode')
  })

  it('rejects an unknown rows mode without a request', async () => {
    const h = harness({ env, responder: appliedPlan })
    expect(await h.run('config', 'apply', configDir(), '--rows-mode', 'truncate')).toBe(EXIT.usage)
    expect(h.requests).toHaveLength(0)
  })
})
