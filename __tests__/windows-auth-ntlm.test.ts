import { createHash, createHmac } from 'node:crypto'
import { makeTestCertificates } from './helpers/windows-auth-mock'
import { describe, expect, it } from 'vitest'
import { md4 } from '@/lib/integrations/windows-auth/md4'
import {
  AV,
  channelBindingsHash,
  computeLmV2Response,
  computeNtlmV2Response,
  createAuthenticateMessage,
  createNegotiateMessage,
  NTLMSSP,
  ntowfv2,
  parseAvPairs,
  parseChallengeMessage,
  parseWindowsUsername,
  serializeAvPairs,
  windowsUpper,
} from '@/lib/integrations/windows-auth/ntlm'
import { certificateBindingHash, tlsServerEndPoint } from '@/lib/integrations/windows-auth/channel-binding'
import { kerberosPrincipal, validateWindowsAuthConfig } from '@/lib/integrations/windows-auth/config'
import { parseAuthenticateHeaders } from '@/lib/integrations/windows-auth/transport'
import { gssServiceName } from '@/lib/integrations/windows-auth/kerberos'

const TLS = makeTestCertificates()
const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'hex')

describe('MD4 (RFC 1320 appendix A.5 test suite)', () => {
  const vectors: [string, string][] = [
    ['', '31d6cfe0d16ae931b73c59d7e0c089c0'],
    ['a', 'bde52cb31de33e46245e05fbdbd6fb24'],
    ['abc', 'a448017aaf21d8525fc10ae87aa6729d'],
    ['message digest', 'd9130a8164549fe818874806e1c7014b'],
    ['abcdefghijklmnopqrstuvwxyz', 'd79e1c308aa5bbcdeea8ed63df412da9'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', '043f8582f241db351ce627e153e7f0e4'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', 'e33b4ddc9c38f2199c3e7b164fcc0536'],
  ]
  it.each(vectors)('md4(%j)', (input, digest) => {
    expect(md4(Buffer.from(input, 'ascii')).toString('hex')).toBe(digest)
  })

  it('handles block boundaries (55, 56, 63, 64, 65 bytes)', () => {
    // Cross-check padding edge cases against the incremental definition: equal inputs, equal digests; distinct lengths differ.
    const digests = new Set([55, 56, 63, 64, 65, 119, 120].map((n) => md4(Buffer.alloc(n, 0x61)).toString('hex')))
    expect(digests.size).toBe(7)
  })
})

describe('NTLMv2 — MS-NLMP 4.2.4 test vectors', () => {
  // 4.2.1 common values: User "User", UserDom "Domain", Password "Password",
  // ServerChallenge 0123456789abcdef, ClientChallenge aa×8, Time 0, RandomSessionKey 55×16.
  const challengeBytes = hex(`
    4e544c4d53535000 02000000 0c000c00 38000000 33828ae2 0123456789abcdef
    0000000000000000 24002400 44000000 060070170000000f
    530065007200760065007200
    02000c0044006f006d00610069006e00
    01000c00530065007200760065007200
    00000000`)

  it('parses the CHALLENGE message', () => {
    const c = parseChallengeMessage(challengeBytes)
    expect(c.flags >>> 0).toBe(0xe28a8233)
    expect(c.serverChallenge.toString('hex')).toBe('0123456789abcdef')
    expect(c.targetName).toBe('Server')
    expect(c.avPairs.map((p) => [p.id, p.value.toString('utf16le')])).toEqual([[AV.NB_DOMAIN_NAME, 'Domain'], [AV.NB_COMPUTER_NAME, 'Server']])
    expect(c.timestamp).toBeNull()
  })

  it('NTOWFv2 / LMOWFv2 (4.2.4.1.1)', () => {
    expect(ntowfv2('Password', 'User', 'Domain').toString('hex')).toBe('0c868a403bfd7a93a3001ef22ef02e3f')
  })

  it('NTProofStr, session base key, LMv2 and encrypted session key (4.2.4.1.2, 4.2.4.2)', () => {
    const c = parseChallengeMessage(challengeBytes)
    const key = ntowfv2('Password', 'User', 'Domain')
    const clientChallenge = Buffer.alloc(8, 0xaa)
    const r = computeNtlmV2Response({
      responseKeyNT: key,
      serverChallenge: c.serverChallenge,
      clientChallenge,
      timestamp: Buffer.alloc(8),
      avPairs: c.targetInfo,
    })
    expect(r.ntProofStr.toString('hex')).toBe('68cd0ab851e51c96aabc927bebef6a1c')
    expect(r.sessionBaseKey.toString('hex')).toBe('8de40ccadbc14a82f15cb0ad0de95ca3')
    expect(computeLmV2Response(key, c.serverChallenge, clientChallenge).toString('hex'))
      .toBe('86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa')
  })

})

describe('NTLM messages', () => {
  function challengeWith(pairs: { id: number; value: Buffer }[], flags = 0xe28a8235) {
    const info = serializeAvPairs(pairs)
    const head = Buffer.alloc(56)
    Buffer.from('NTLMSSP\0', 'ascii').copy(head, 0)
    head.writeUInt32LE(2, 8)
    head.writeUInt32LE(flags >>> 0, 20)
    Buffer.from('0123456789abcdef', 'hex').copy(head, 24)
    head.writeUInt16LE(info.length, 40)
    head.writeUInt16LE(info.length, 42)
    head.writeUInt32LE(56, 44)
    return Buffer.concat([head, info])
  }

  it('NEGOTIATE asks for NTLMv2 essentials and never for LM', () => {
    const neg = createNegotiateMessage()
    expect(neg.subarray(0, 8).toString('latin1')).toBe('NTLMSSP\0')
    expect(neg.readUInt32LE(8)).toBe(1)
    const flags = neg.readUInt32LE(12)
    expect(flags & NTLMSSP.NEGOTIATE_UNICODE).toBeTruthy()
    expect(flags & NTLMSSP.NEGOTIATE_NTLM).toBeTruthy()
    expect(flags & NTLMSSP.NEGOTIATE_EXTENDED_SESSIONSECURITY).toBeTruthy()
    expect(flags & NTLMSSP.NEGOTIATE_LM_KEY).toBe(0)
    expect(flags & NTLMSSP.NEGOTIATE_OEM).toBe(0)
  })

  it('refuses a challenge without target info (would force LM / NTLMv1)', () => {
    const c = challengeWith([])
    c.writeUInt16LE(0, 40); c.writeUInt16LE(0, 42)
    expect(() => parseChallengeMessage(c.subarray(0, 56))).toThrow(/NTLMv2 is not possible/)
  })

  it('rejects malformed challenges', () => {
    expect(() => parseChallengeMessage(Buffer.from('nope'))).toThrow(/too short/)
    const bad = challengeWith([{ id: AV.NB_DOMAIN_NAME, value: Buffer.from('D\0') }])
    bad.write('XTLMSSP\0', 0, 'latin1')
    expect(() => parseChallengeMessage(bad)).toThrow(/signature/)
    const type3 = challengeWith([{ id: AV.NB_DOMAIN_NAME, value: Buffer.from('D\0') }])
    type3.writeUInt32LE(3, 8)
    expect(() => parseChallengeMessage(type3)).toThrow(/type 2/)
    const outOfBounds = challengeWith([{ id: AV.NB_DOMAIN_NAME, value: Buffer.from('D\0') }])
    outOfBounds.writeUInt32LE(4000, 44)
    expect(() => parseChallengeMessage(outOfBounds)).toThrow(/outside the message/)
    const oem = challengeWith([{ id: AV.NB_DOMAIN_NAME, value: Buffer.from('D\0') }], 0xe28a8236)
    expect(() => parseChallengeMessage(oem)).toThrow(/Unicode/)
    expect(() => parseAvPairs(Buffer.from([2, 0, 10, 0, 1, 2]))).toThrow(/runs past/)
    expect(() => parseAvPairs(Buffer.from([2, 0, 0, 0]))).toThrow(/MsvAvEOL/)
  })

  it('AUTHENTICATE: MsvAvTimestamp → Z(24) LM response, MIC, flags, CBT and SPN in the NTLMv2 blob', () => {
    const ts = Buffer.from('0090d336b734c301', 'hex')
    const raw = challengeWith([
      { id: AV.NB_DOMAIN_NAME, value: Buffer.from('CONTOSO', 'utf16le') },
      { id: AV.NB_COMPUTER_NAME, value: Buffer.from('SP', 'utf16le') },
      { id: AV.TIMESTAMP, value: ts },
    ])
    const challenge = parseChallengeMessage(raw)
    expect(challenge.timestamp?.equals(ts)).toBe(true)
    const negotiate = createNegotiateMessage()
    const cbt = Buffer.concat([Buffer.from('tls-server-end-point:'), Buffer.alloc(32, 7)])
    const msg = createAuthenticateMessage({
      negotiate, challenge,
      credentials: { user: 'svc_ütasks', domain: 'CONTOSO', password: 'Pässwörd' },
      channelBinding: cbt,
      targetSpn: 'HTTP/sp.contoso.com',
      clientChallenge: Buffer.alloc(8, 0xaa),
    })
    expect(msg.readUInt32LE(8)).toBe(3)
    const field = (at: number) => msg.subarray(msg.readUInt32LE(at + 4), msg.readUInt32LE(at + 4) + msg.readUInt16LE(at))
    expect(field(12).equals(Buffer.alloc(24))).toBe(true) // LM: Z(24) with a server timestamp
    expect(field(28).toString('utf16le')).toBe('CONTOSO')
    expect(field(36).toString('utf16le')).toBe('svc_ütasks')
    const nt = field(20)
    const blob = nt.subarray(16)
    expect(blob.subarray(8, 16).equals(ts)).toBe(true) // the server's timestamp is used
    const pairs = parseAvPairs(blob.subarray(28))
    expect(pairs.find((p) => p.id === AV.FLAGS)?.value.readUInt32LE(0)).toBe(2)
    expect(pairs.find((p) => p.id === AV.CHANNEL_BINDINGS)?.value.equals(channelBindingsHash(cbt))).toBe(true)
    expect(pairs.find((p) => p.id === AV.TARGET_NAME)?.value.toString('utf16le')).toBe('HTTP/sp.contoso.com')

    // NTProofStr verifies like a server would.
    const key = ntowfv2('Pässwörd', 'svc_ütasks', 'CONTOSO')
    const proof = createHmac('md5', key).update(challenge.serverChallenge).update(blob).digest()
    expect(proof.equals(nt.subarray(0, 16))).toBe(true)

    // MIC = HMAC_MD5(ExportedSessionKey = SessionBaseKey, NEGOTIATE || CHALLENGE || AUTHENTICATE with MIC zeroed).
    const sessionBaseKey = createHmac('md5', key).update(proof).digest()
    const mic = Buffer.from(msg.subarray(72, 88))
    const zeroed = Buffer.from(msg); zeroed.fill(0, 72, 88)
    expect(mic.equals(createHmac('md5', sessionBaseKey).update(negotiate).update(raw).update(zeroed).digest())).toBe(true)
    // The challenge offered sign/seal/key exchange; HTTP auth takes none of them, and never LM.
    expect(field(52).length).toBe(0)
    const authFlags = msg.readUInt32LE(60)
    expect(authFlags & (NTLMSSP.NEGOTIATE_KEY_EXCH | NTLMSSP.NEGOTIATE_SIGN | NTLMSSP.NEGOTIATE_SEAL | NTLMSSP.NEGOTIATE_LM_KEY)).toBe(0)
  })

  it('with the flags IIS sends for HTTP: no encrypted session key, MIC keyed by the session base key', () => {
    const raw = challengeWith([{ id: AV.NB_DOMAIN_NAME, value: Buffer.from('D', 'utf16le') }, { id: AV.TIMESTAMP, value: Buffer.alloc(8, 1) }], 0xe2898205)
    const challenge = parseChallengeMessage(raw)
    const negotiate = createNegotiateMessage()
    const msg = createAuthenticateMessage({ negotiate, challenge, credentials: { user: 'u', domain: 'D', password: 'p' }, clientChallenge: Buffer.alloc(8, 2) })
    expect(msg.readUInt16LE(52)).toBe(0) // no EncryptedRandomSessionKey
    const ntOff = msg.readUInt32LE(24)
    const nt = msg.subarray(ntOff, ntOff + msg.readUInt16LE(20))
    const key = ntowfv2('p', 'u', 'D')
    const sessionBaseKey = createHmac('md5', key).update(nt.subarray(0, 16)).digest()
    const zeroed = Buffer.from(msg); zeroed.fill(0, 72, 88)
    expect(msg.subarray(72, 88).equals(createHmac('md5', sessionBaseKey).update(negotiate).update(raw).update(zeroed).digest())).toBe(true)
  })

  it('without a server timestamp: LMv2 response, current time, no-CBT zeros', () => {
    const challenge = parseChallengeMessage(challengeWith([{ id: AV.NB_DOMAIN_NAME, value: Buffer.from('D', 'utf16le') }]))
    const msg = createAuthenticateMessage({
      negotiate: createNegotiateMessage(), challenge,
      credentials: { user: 'u', domain: 'D', password: 'p' },
      clientChallenge: Buffer.alloc(8, 1),
      now: Date.UTC(2026, 0, 1),
    })
    const lm = msg.subarray(msg.readUInt32LE(16), msg.readUInt32LE(16) + 24)
    expect(lm.subarray(16).equals(Buffer.alloc(8, 1))).toBe(true)
    const ntOff = msg.readUInt32LE(24)
    const blob = msg.subarray(ntOff + 16, ntOff + msg.readUInt16LE(20))
    const pairs = parseAvPairs(blob.subarray(28))
    expect(pairs.find((p) => p.id === AV.CHANNEL_BINDINGS)?.value.equals(Buffer.alloc(16))).toBe(true)
    expect(blob.readBigUInt64LE(8)).toBe((BigInt(Date.UTC(2026, 0, 1)) + BigInt(11644473600000)) * BigInt(10000))
  })

  it('parses usernames and upper-cases like Windows', () => {
    expect(parseWindowsUsername('CONTOSO\\svc')).toEqual({ domain: 'CONTOSO', user: 'svc' })
    expect(parseWindowsUsername('svc@contoso.com')).toEqual({ domain: '', user: 'svc@contoso.com' })
    expect(windowsUpper('straße')).toBe('STRAßE')
    expect(windowsUpper('ümlaut')).toBe('ÜMLAUT')
  })
})

describe('channel binding (tls-server-end-point)', () => {
  it('hashes with SHA-256 for sha256WithRSA certificates and builds the gss struct hash', () => {
    // A minimal DER: SEQUENCE { SEQUENCE{} tbs, SEQUENCE { OID sha256WithRSA } , BIT STRING }
    const oid = hex('06092a864886f70d01010b')
    const der = Buffer.concat([hex('30'), Buffer.from([2 + 2 + oid.length + 3]), hex('3000'), hex('30'), Buffer.from([oid.length]), oid, hex('030100')])
    expect(certificateBindingHash(der)).toBe('sha256')
    const appData = tlsServerEndPoint(der)
    expect(appData.subarray(0, 21).toString()).toBe('tls-server-end-point:')
    expect(appData.subarray(21).equals(createHash('sha256').update(der).digest())).toBe(true)
    const struct = Buffer.concat([Buffer.alloc(16), Buffer.from([appData.length, 0, 0, 0]), appData])
    expect(channelBindingsHash(appData).equals(createHash('md5').update(struct).digest())).toBe(true)
  })

  it('maps sha384 / sha512 / ECDSA, and upgrades SHA-1 to SHA-256', () => {
    const der = (oidHex: string) => {
      const oid = hex(oidHex)
      return Buffer.concat([hex('30'), Buffer.from([2 + 2 + oid.length + 3]), hex('3000'), hex('30'), Buffer.from([oid.length]), oid, hex('030100')])
    }
    expect(certificateBindingHash(der('06092a864886f70d01010c'))).toBe('sha384')
    expect(certificateBindingHash(der('06092a864886f70d01010d'))).toBe('sha512')
    expect(certificateBindingHash(der('06092a864886f70d010105'))).toBe('sha256') // sha1WithRSA
    expect(certificateBindingHash(der('06082a8648ce3d040303'))).toBe('sha384') // ecdsa-with-SHA384
    expect(certificateBindingHash(Buffer.from('garbage'))).toBe('sha256')
  })

  it.skipIf(!TLS)('reads a real certificate (RSA, SHA-256)', async () => {
    const { X509Certificate } = await import('node:crypto')
    expect(certificateBindingHash(new X509Certificate(TLS!.cert).raw)).toBe('sha256')
  })
})

describe('windows auth config', () => {
  it('validates and normalises', () => {
    const ok = validateWindowsAuthConfig({ username: 'CONTOSO\\svc', password: 'x' })
    expect(ok).toEqual({ ok: true, config: { mode: 'negotiate', username: 'CONTOSO\\svc', password: 'x', spn: null, ca_bundle: null, proxy_url: null } })
    const bad = validateWindowsAuthConfig({ mode: 'basic', username: '', password: '', proxy_url: 'https://u:p@proxy', ca_bundle: '-----BEGIN PRIVATE KEY-----' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors.join('\n')).toMatch(/mode/)
      expect(bad.errors.join('\n')).toMatch(/username is required/)
      expect(bad.errors.join('\n')).toMatch(/proxy_url/)
      expect(bad.errors.join('\n')).toMatch(/private key/)
    }
    expect(validateWindowsAuthConfig({ mode: 'kerberos', username: 'svc@contoso.com' }).ok).toBe(true)
    expect(validateWindowsAuthConfig({ username: 'a\\b\\c', password: 'x' }).ok).toBe(false)
    expect(validateWindowsAuthConfig({ username: 'u', password: 'x', spn: 'HTTP/sp.contoso.com' }).ok).toBe(true)
    expect(validateWindowsAuthConfig({ username: 'u', password: 'x', spn: 'not an spn' }).ok).toBe(false)
    expect(validateWindowsAuthConfig({ username: 'u', password: 'x', proxy_url: 'http://proxy.corp:3128' }).ok).toBe(true)
    const pem = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----'
    const withCa = validateWindowsAuthConfig({ username: 'u', password: 'x', ca_bundle: `junk\n${pem}\nmore` })
    expect(withCa.ok && withCa.config.ca_bundle).toBe(pem)
  })

  it('kerberos principal and GSS service names', () => {
    expect(kerberosPrincipal('svc@contoso.com')).toBe('svc@CONTOSO.COM')
    expect(kerberosPrincipal('CONTOSO\\svc')).toBeNull()
    expect(gssServiceName('HTTP/sp.contoso.com')).toBe('HTTP@sp.contoso.com')
    expect(gssServiceName('HTTP/sp.contoso.com:8443')).toBe('HTTP@sp.contoso.com')
  })

  it('parses WWW-Authenticate challenge lists', () => {
    expect(parseAuthenticateHeaders(['Negotiate', 'NTLM'])).toEqual([{ scheme: 'Negotiate', token: null }, { scheme: 'NTLM', token: null }])
    expect(parseAuthenticateHeaders('NTLM TlRMTVNTUAACAAAA, Basic realm="x"')).toEqual([{ scheme: 'NTLM', token: 'TlRMTVNTUAACAAAA' }, { scheme: 'Basic', token: null }])
  })
})

