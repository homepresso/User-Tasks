import { describe, expect, it } from 'vitest'
import { splitApiPath } from '../src/commands/api'
import { EXIT } from '../src/exit-codes'
import { harness, ok } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }

describe('usertasks api', () => {
  it('prints the raw (still enveloped) JSON body', async () => {
    const h = harness({ env, tty: true, responder: () => ok({ workflows: [], total: 0 }) })
    expect(await h.run('api', 'GET', '/workflows', '-q', 'active=false')).toBe(0)
    expect(h.requests[0].url.toString()).toBe('https://tasks.test/api/v1/workflows?active=false')
    expect(JSON.parse(h.stdout())).toEqual({ success: true, data: { workflows: [], total: 0 } })
  })

  it('accepts /api/v1 prefixes, inline query strings and lower-case methods', async () => {
    const h = harness({ env, responder: () => ok({}) })
    expect(await h.run('api', 'get', '/api/v1/tasks?status=todo&status=done', '-q', 'limit=5')).toBe(0)
    expect(h.requests[0].url.pathname).toBe('/api/v1/tasks')
    expect(h.requests[0].url.searchParams.getAll('status')).toEqual(['todo', 'done'])
    expect(h.requests[0].url.searchParams.get('limit')).toBe('5')
  })

  it('sends a body from stdin and --set', async () => {
    const h = harness({ env, stdin: 'values:\n  tier: gold\n', responder: () => ok({ outputs: {} }) })
    expect(await h.run('api', 'POST', 'decision-tables/d1/test', '-f', '-', '--set', 'values.region=eu')).toBe(0)
    expect(h.requests[0].method).toBe('POST')
    expect(h.requests[0].body).toEqual({ values: { tier: 'gold', region: 'eu' } })
  })

  it('maps HTTP errors to exit codes', async () => {
    const h = harness({ env, responder: () => ({ status: 404, body: { success: false, error: 'Not found' } }) })
    expect(await h.run('api', 'GET', '/workflows/nope')).toBe(EXIT.notFound)
    expect(await harness({ env }).run('api', 'FETCH', '/workflows')).toBe(EXIT.usage)
  })

  it('confirms DELETE on a terminal', async () => {
    const h = harness({ env, tty: true, confirm: false })
    expect(await h.run('api', 'DELETE', '/agents/a1')).toBe(1)
    expect(h.requests).toHaveLength(0)
  })
})

describe('splitApiPath', () => {
  it('normalises paths', () => {
    expect(splitApiPath('workflows')).toEqual({ path: '/workflows', query: {} })
    expect(splitApiPath('/api/v1')).toEqual({ path: '/', query: {} })
    expect(splitApiPath('/api/v1x')).toEqual({ path: '/api/v1x', query: {} })
    expect(splitApiPath('/me?a=1')).toEqual({ path: '/me', query: { a: '1' } })
  })
})
