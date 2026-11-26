/**
 * Request ids (proxy.ts) and the JSON error line (instrumentation.ts
 * onRequestError): an error digest shown to a user can be tied to one log line.
 */
import { describe, expect, it } from 'vitest'
import { resolveRequestId } from '@/lib/request-id'
import { requestErrorLine } from '@/lib/request-error-log'
import * as instrumentation from '@/instrumentation'

describe('resolveRequestId', () => {
  it("keeps a caller's well-formed id, mints one otherwise", () => {
    expect(resolveRequestId('lb-7f3a9c21-0001')).toBe('lb-7f3a9c21-0001')
    expect(resolveRequestId(null, () => 'minted')).toBe('minted')
    expect(resolveRequestId('short', () => 'minted')).toBe('minted')
    expect(resolveRequestId('bad id\r\nx-injected: 1', () => 'minted')).toBe('minted')
    expect(resolveRequestId('x'.repeat(129), () => 'minted')).toBe('minted')
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('requestErrorLine', () => {
  it('one JSON line with digest, request id, route; no query string', () => {
    const err = Object.assign(new Error('relation "x" does not exist'), { digest: '1234567' })
    const line = requestErrorLine(err, { path: '/p/abc?token=secret-token', method: 'GET', headers: { 'x-request-id': 'req-12345678' } }, { routePath: '/p/[token]', routeType: 'render', renderSource: 'react-server-components' })
    expect(line).not.toContain('\n')
    const parsed = JSON.parse(line)
    expect(parsed).toMatchObject({ level: 'error', digest: '1234567', requestId: 'req-12345678', method: 'GET', path: '/p/abc', route: '/p/[token]', routeType: 'render', message: 'relation "x" does not exist' })
    expect(line).not.toContain('secret-token')
  })

  it('is exported as onRequestError from instrumentation.ts', () => {
    expect(typeof instrumentation.onRequestError).toBe('function')
  })
})
