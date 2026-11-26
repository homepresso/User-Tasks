import { describe, expect, it } from 'vitest'
import { assertSafeResolvedAddress, EgressBlockedError } from '@/lib/egress-guard'

// Special-purpose ranges are never a public service (2026-11 QA pass): the
// guard treated them as public.
describe('egress guard: special-purpose ranges', () => {
  it.each([
    '192.0.0.10', '198.18.0.1', '198.19.255.254', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    '168.63.129.16', 'ff02::1', '::ffff:198.18.0.1',
  ])('blocks %s', (address) => {
    expect(() => assertSafeResolvedAddress('x.example.com', address)).toThrow(EgressBlockedError)
  })
  it.each(['93.184.216.34', '198.20.0.1', '192.0.2.200', '2606:4700::1111'])('still allows public %s', (address) => {
    expect(() => assertSafeResolvedAddress('x.example.com', address)).not.toThrow()
  })
})
