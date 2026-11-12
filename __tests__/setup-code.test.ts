import { describe, expect, it } from 'vitest'
import {
  codesMatch, envSetupCode, formatSetupCode, generateSetupCode, hashSetupCode, normalizeSetupCode,
  setupCodeLogLine, verifySetupCode, SETUP_CODE_ALPHABET,
} from '@/lib/setup/code'

describe('first-run setup code', () => {
  it('generates XXXX-XXXX-XXXX codes from an alphabet without look-alikes', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const code = generateSetupCode()
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      expect(code).not.toMatch(/[IO01]/)
      seen.add(code)
    }
    expect(seen.size).toBe(50)
    expect(SETUP_CODE_ALPHABET).toHaveLength(32)
  })

  it('normalises case, spaces and dashes', () => {
    expect(normalizeSetupCode(' abcd efgh-jklm ')).toBe('ABCDEFGHJKLM')
    expect(formatSetupCode('abcdefghjklm')).toBe('ABCD-EFGH-JKLM')
    expect(formatSetupCode('my-own-code')).toBe('my-own-code')
  })

  it('stores only a salted scrypt hash and verifies in constant time', () => {
    const code = generateSetupCode()
    const hash = hashSetupCode(code)
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(hash).not.toContain(normalizeSetupCode(code))
    // Salted: the same code hashes differently each time.
    expect(hashSetupCode(code)).not.toBe(hash)
    expect(verifySetupCode(code, hash)).toBe(true)
    expect(verifySetupCode(code.toLowerCase().replace(/-/g, ' '), hash)).toBe(true)
    expect(verifySetupCode('AAAA-AAAA-AAAA', hash)).toBe(false)
    expect(verifySetupCode('', hash)).toBe(false)
    expect(verifySetupCode(code, null)).toBe(false)
    expect(verifySetupCode(code, 'sha256$abc')).toBe(false)
    expect(verifySetupCode(code, hash.replace('16384', '2'))).toBe(false)
  })

  it('reads USERTASKS_SETUP_CODE (normalised; too short is ignored)', () => {
    expect(envSetupCode({})).toBeNull()
    expect(envSetupCode({ USERTASKS_SETUP_CODE: '  ' })).toBeNull()
    expect(envSetupCode({ USERTASKS_SETUP_CODE: 'short' })).toEqual({ invalid: true })
    expect(envSetupCode({ USERTASKS_SETUP_CODE: 'helm-set-code-2026' })).toEqual({ code: 'HELMSETCODE2026' })
    expect(codesMatch('helm set code 2026', 'HELMSETCODE2026')).toBe(true)
    expect(codesMatch('helm-set-code-2027', 'HELMSETCODE2026')).toBe(false)
    expect(codesMatch('HELM', 'HELMSETCODE2026')).toBe(false)
    expect(codesMatch('', '')).toBe(false)
  })

  it('prints the log line operators search for', () => {
    expect(setupCodeLogLine('abcdefghjklm')).toBe('UserTasks setup code: ABCD-EFGH-JKLM (open /setup to create the admin account)')
  })
})
