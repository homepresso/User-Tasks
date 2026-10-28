import { describe, expect, it } from 'vitest'
import { UsertasksApiError, UsertasksNetworkError } from '@usertasks/sdk'
import { CliAuthError, CliUsageError, EXIT, exitCodeFor } from '../src/exit-codes'
import { harness } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }

describe('exitCodeFor', () => {
  it.each([
    [401, EXIT.unauthenticated],
    [403, EXIT.forbidden],
    [404, EXIT.notFound],
    [400, EXIT.validation],
    [409, EXIT.validation],
    [422, EXIT.validation],
    [429, EXIT.rateLimited],
    [500, EXIT.unavailable],
    [503, EXIT.unavailable],
    [418, EXIT.error],
  ])('HTTP %i → %i', (status, code) => {
    expect(exitCodeFor(new UsertasksApiError({ status, message: 'x' }))).toBe(code)
  })

  it('maps CLI and transport errors', () => {
    expect(exitCodeFor(new CliUsageError('x'))).toBe(EXIT.usage)
    expect(exitCodeFor(new CliAuthError('x'))).toBe(EXIT.unauthenticated)
    expect(exitCodeFor(new UsertasksNetworkError('x'))).toBe(EXIT.unavailable)
    expect(exitCodeFor(new Error('x'))).toBe(EXIT.error)
  })
})

describe('end-to-end exit codes', () => {
  it('reports API errors with code, details and request id on stderr', async () => {
    const h = harness({
      env,
      responder: () => ({
        status: 400,
        headers: { 'x-request-id': 'req_1' },
        body: { success: false, error: 'Validation failed', code: 'validation_error', details: [{ path: 'body.name', message: 'Required' }] },
      }),
    })
    expect(await h.run('decision-tables', 'create')).toBe(EXIT.validation)
    expect(h.stderr()).toContain('error: Validation failed (HTTP 400, validation_error)')
    expect(h.stderr()).toContain('body.name: Required')
    expect(h.stderr()).toContain('request id: req_1')
    expect(h.stdout()).toBe('')
  })

  it.each([
    [403, EXIT.forbidden],
    [404, EXIT.notFound],
    [429, EXIT.rateLimited],
  ])('HTTP %i exits %i', async (status, code) => {
    const h = harness({ env, responder: () => ({ status, body: { success: false, error: 'nope' }, headers: { 'Retry-After': '0' } }) })
    expect(await h.run('workflows', 'get', 'w1')).toBe(code)
  })

  it('usage errors exit 2, help exits 0', async () => {
    expect(await harness().run('--bogus')).toBe(EXIT.usage)
    expect(await harness().run('workflows', 'get')).toBe(EXIT.usage)
    expect(await harness({ env: { USERTASKS_OUTPUT: 'xml', ...env } }).run('whoami')).toBe(EXIT.usage)
    expect(await harness().run('--help')).toBe(EXIT.ok)
    expect(await harness().run('--version')).toBe(EXIT.ok)
  })

  it('missing credentials exit 3 without calling the server', async () => {
    const h = harness({ env: { USERTASKS_URL: 'https://tasks.test' } })
    expect(await h.run('workflows', 'list')).toBe(EXIT.unauthenticated)
    expect(h.requests).toHaveLength(0)
  })
})
