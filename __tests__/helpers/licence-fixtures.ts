/**
 * Throwaway licence keys and licences for tests. Keys are generated per test
 * run and never written anywhere.
 */
import { generateKeyPairSync } from 'node:crypto'
import { keyringEntryFor, signLicence } from '@/lib/licensing/format'
import type { LicenceKey } from '@/lib/licensing/keyring'
import { LICENCE_FORMAT_VERSION, LICENCE_KIND, type LicenceDocument } from '@/lib/licensing/types'

export function throwawayKey(kid = 'test-1'): { pem: string; entry: LicenceKey } {
  const { privateKey } = generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  return { pem, entry: keyringEntryFor(pem, kid) }
}

export function makeLicence(pem: string, kid: string, overrides: Partial<Omit<LicenceDocument, 'signature' | 'kid'>> = {}): LicenceDocument {
  return signLicence({
    format: LICENCE_FORMAT_VERSION,
    kind: LICENCE_KIND,
    licence_id: 'lic_test_1',
    customer: { name: 'Example Corp' },
    issued_at: '2026-11-01T00:00:00.000Z',
    expires_at: '2027-11-01T00:00:00.000Z',
    extensions: [{ id: 'sharepoint', features: ['connector', 'importers'], limits: { farms: 2 } }],
    ...overrides,
  }, pem, kid)
}
