import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AD_IN_CHAIN_OID,
  createLdapClient,
  escapeLdapFilterValue,
  formatObjectGuid,
  normalizeDn,
  resolveLdapSettings,
  toGeneralizedTime,
  verifyLdapPassword,
  type LdapConnection,
  type LdapConnectionFactory,
  type LdapEntry,
} from '@/lib/directory-sync/ldap'

/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */

/**
 * LDAP client against a fake transport: settings and flavour defaults,
 * filter escaping, attribute mapping (objectGUID, userAccountControl),
 * nested groups (AD IN_CHAIN and generic recursion with cycles), delta
 * cursors, bind login lookups and password binds, TLS options and the egress
 * guard. The real-server path is covered by __tests__/directory-ldap-db.test.ts
 * against an OpenLDAP container.
 */

interface Call { op: string; base?: string; options?: Record<string, any>; dn?: string; password?: string }

function fakeDirectory(handler: (base: string, options: Record<string, any>) => Array<Record<string, unknown>>, opts: { bindError?: (dn: string, pw?: string) => Error | null } = {}) {
  const calls: Call[] = []
  const factoryOptions: Array<Record<string, any>> = []
  const factory: LdapConnectionFactory = async (options) => {
    factoryOptions.push(options)
    const connection: LdapConnection = {
      async startTLS(tls) { calls.push({ op: 'startTLS', options: tls }) },
      async bind(dn, password) {
        calls.push({ op: 'bind', dn, password })
        const error = opts.bindError?.(dn, password)
        if (error) throw error
      },
      async search(base, options) {
        calls.push({ op: 'search', base, options })
        return { searchEntries: handler(base, options) as LdapEntry[] }
      },
      async unbind() { calls.push({ op: 'unbind' }) },
    }
    return connection
  }
  return { factory, calls, factoryOptions }
}

const AD = {
  url: 'ldaps://dc1.corp.example.com:636',
  bind_dn: 'CN=svc,OU=Service,DC=corp,DC=example,DC=com',
  base_dn: 'DC=corp,DC=example,DC=com',
  flavor: 'active_directory',
}
const OPENLDAP = {
  url: 'ldap://ldap.example.com:389',
  start_tls: true,
  ca_cert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  bind_dn: 'cn=admin,dc=example,dc=com',
  base_dn: 'dc=example,dc=com',
  flavor: 'openldap',
}

const guid = (hex: string) => Buffer.from(hex, 'hex')

let savedEgress: string | undefined
beforeEach(() => {
  savedEgress = process.env.ALLOW_PRIVATE_EGRESS
  process.env.ALLOW_PRIVATE_EGRESS = 'true'
})
afterEach(() => {
  if (savedEgress === undefined) delete process.env.ALLOW_PRIVATE_EGRESS
  else process.env.ALLOW_PRIVATE_EGRESS = savedEgress
})

describe('LDAP helpers', () => {
  it('escapes filter values per RFC 4515', () => {
    expect(escapeLdapFilterValue('a*b(c)d\\e\0f')).toBe('a\\2ab\\28c\\29d\\5ce\\00f')
    expect(escapeLdapFilterValue('*)(uid=*))(|(uid=*')).toBe('\\2a\\29\\28uid=\\2a\\29\\29\\28|\\28uid=\\2a')
  })

  it('formats objectGUID like Windows does (mixed endian)', () => {
    expect(formatObjectGuid(guid('2b6dc5f4f0e1d842a40b1a6c3d2e1f00'))).toBe('f4c56d2b-e1f0-42d8-a40b-1a6c3d2e1f00')
  })

  it('normalizes DNs for comparison', () => {
    expect(normalizeDn('CN=Ada Lovelace, OU=People ,DC=Corp')).toBe('cn=ada lovelace,ou=people,dc=corp')
  })

  it('formats generalized time', () => {
    expect(toGeneralizedTime(new Date('2026-10-26T05:04:03Z'))).toBe('20261026050403Z')
  })

  it('fills flavour defaults and validates settings', () => {
    const ad = resolveLdapSettings(AD)
    expect(ad.userFilter).toBe('(&(objectCategory=person)(objectClass=user))')
    expect(ad.map.id).toBe('objectGUID')
    expect(ad.loginAttributes).toEqual(['mail', 'userPrincipalName', 'sAMAccountName'])
    const custom = resolveLdapSettings({ ...OPENLDAP, attributes: { email: 'userPrincipalName' }, user_filter: '(objectClass=person)' })
    expect(custom.map.email).toBe('userPrincipalName')
    expect(custom.map.username).toBe('uid')
    expect(custom.userFilter).toBe('(objectClass=person)')
    expect(() => resolveLdapSettings({ ...AD, url: 'http://dc1' })).toThrow()
    expect(() => resolveLdapSettings({ ...AD, user_filter: 'objectClass=person' })).toThrow()
    expect(() => resolveLdapSettings({ ...AD, attributes: { email: 'mail)(x' } })).toThrow()
  })
})

describe('LDAP client', () => {
  it('Active Directory: maps users, honours the disabled bit and resolves nested membership with IN_CHAIN', async () => {
    const dir = fakeDirectory((base, options) => {
      if (base === '') return [{ dn: '', highestCommittedUSN: '9001', dnsHostName: 'dc1.corp.example.com' }]
      if (options.filter === '(objectClass=group)') {
        return [{ dn: 'CN=Engineering,OU=Groups,DC=corp,DC=example,DC=com', objectGUID: guid('00112233445566778899aabbccddeeff'), cn: 'Engineering', description: 'Eng' }]
      }
      if (String(options.filter).includes(AD_IN_CHAIN_OID)) return [{ dn: 'CN=Ada', objectGUID: guid('2b6dc5f4f0e1d842a40b1a6c3d2e1f00') }]
      return [
        { dn: 'CN=Ada,OU=People,DC=corp,DC=example,DC=com', objectGUID: guid('2b6dc5f4f0e1d842a40b1a6c3d2e1f00'), sAMAccountName: 'ada', mail: 'Ada@Corp.example.com', displayName: 'Ada Lovelace', userAccountControl: '512' },
        { dn: 'CN=Bob,OU=People,DC=corp,DC=example,DC=com', objectGUID: guid('ffeeddccbbaa99887766554433221100'), sAMAccountName: 'bob', userPrincipalName: 'bob@corp.example.com', givenName: 'Bob', sn: 'Smith', userAccountControl: '514' },
      ]
    })
    const client = createLdapClient({ settings: AD, bindPassword: 'pw', connect: dir.factory })
    const users = await client.listUsers()
    expect(users.map((u) => [u.externalId, u.email, u.displayName, u.active])).toEqual([
      ['f4c56d2b-e1f0-42d8-a40b-1a6c3d2e1f00', 'ada@corp.example.com', 'Ada Lovelace', true],
      ['ccddeeff-aabb-8899-7766-554433221100', 'bob@corp.example.com', 'Bob Smith', false], // UPN fallback; 514 = disabled
    ])
    const [group] = await client.listGroups()
    expect(group).toEqual({ externalId: '33221100-5544-7766-8899-aabbccddeeff', displayName: 'Engineering', description: 'Eng' })
    expect(await client.listGroupMemberIds(group.externalId)).toEqual(['f4c56d2b-e1f0-42d8-a40b-1a6c3d2e1f00'])
    const chain = dir.calls.find((c) => String(c.options?.filter).includes(AD_IN_CHAIN_OID))!
    expect(chain.options!.filter).toBe(`(&(&(objectCategory=person)(objectClass=user))(memberOf:${AD_IN_CHAIN_OID}:=CN=Engineering,OU=Groups,DC=corp,DC=example,DC=com))`)
    // objectGUID is binary; searches are paged.
    const userSearch = dir.calls.find((c) => c.op === 'search' && c.options?.filter === '(&(objectCategory=person)(objectClass=user))')!
    expect(userSearch.options!.explicitBufferAttributes).toEqual(['objectGUID'])
    expect(userSearch.options!.paged).toEqual({ pageSize: 500 })
    // Delta: highestCommittedUSN, then uSNChanged greater than the cursor.
    expect(await client.deltaCursor!()).toBe('usn:9001')
    await client.listUserChanges!('usn:41')
    expect(dir.calls.some((c) => c.options?.filter === '(&(&(objectCategory=person)(objectClass=user))(uSNChanged>=42))')).toBe(true)
    await client.close!()
    expect(dir.calls.at(-1)?.op).toBe('unbind')
    // ldaps://: TLS from the start, verified, SNI host name.
    expect(dir.factoryOptions[0].tlsOptions).toMatchObject({ rejectUnauthorized: true, servername: 'dc1.corp.example.com' })
    expect(dir.calls[0]).toEqual({ op: 'bind', dn: AD.bind_dn, password: 'pw' })
  })

  it('generic directories: recursive nested groups (cycle-safe), memberUid and modifyTimestamp deltas, StartTLS with a CA', async () => {
    const people = [
      { dn: 'uid=ada,ou=people,dc=example,dc=com', entryUUID: 'U-ADA', uid: 'ada', mail: 'ada@example.com', cn: 'Ada' },
      { dn: 'uid=bob,ou=people,dc=example,dc=com', entryUUID: 'U-BOB', uid: 'bob', mail: 'bob@example.com', cn: 'Bob' },
      { dn: 'uid=cyd,ou=people,dc=example,dc=com', entryUUID: 'U-CYD', uid: 'cyd', mail: 'cyd@example.com', cn: 'Cyd' },
    ]
    const groups = [
      { dn: 'cn=all,ou=groups,dc=example,dc=com', entryUUID: 'G-ALL', cn: 'all', member: ['UID=ADA, OU=People,dc=example,dc=com', 'cn=platform,ou=groups,dc=example,dc=com'] },
      { dn: 'cn=platform,ou=groups,dc=example,dc=com', entryUUID: 'G-PLAT', cn: 'platform', member: ['uid=bob,ou=people,dc=example,dc=com', 'cn=all,ou=groups,dc=example,dc=com'] },
      { dn: 'cn=posix,ou=groups,dc=example,dc=com', entryUUID: 'G-POSIX', cn: 'posix', memberUid: ['cyd', 'nobody'] },
    ]
    const dir = fakeDirectory((_base, options) => (String(options.filter).includes('groupOfNames') ? groups : people))
    const client = createLdapClient({ settings: OPENLDAP, bindPassword: 'pw', connect: dir.factory, now: () => new Date('2026-10-26T12:00:00Z') })
    await client.listUsers()
    await client.listGroups()
    expect((await client.listGroupMemberIds('g-all')).sort()).toEqual(['u-ada', 'u-bob'])
    expect(await client.listGroupMemberIds('g-plat')).toEqual(['u-bob', 'u-ada'])
    expect(await client.listGroupMemberIds('g-posix')).toEqual(['u-cyd'])
    expect(await client.deltaCursor!()).toBe('ts:20261026115000Z')
    await client.listUserChanges!('ts:20261026115000Z')
    expect(dir.calls.some((c) => c.options?.filter === '(&(objectClass=inetOrgPerson)(modifyTimestamp>=20261026115000Z))')).toBe(true)
    expect(dir.calls[0]).toMatchObject({ op: 'startTLS', options: { ca: [OPENLDAP.ca_cert], rejectUnauthorized: true, servername: 'ldap.example.com', minVersion: 'TLSv1.2' } })
    expect(dir.factoryOptions[0].tlsOptions).toBeUndefined()

    const flat = createLdapClient({ settings: { ...OPENLDAP, nested_groups: false }, bindPassword: 'pw', connect: dir.factory })
    await flat.listGroups()
    expect(await flat.listGroupMemberIds('g-all')).toEqual(['u-ada'])
  })

  it('finds a login entry with an escaped filter, and only a unique one', async () => {
    let entries: LdapEntry[] = [{ dn: 'uid=ada,ou=people,dc=example,dc=com', entryUUID: 'u1', uid: 'ada', mail: 'ada@example.com' }]
    const dir = fakeDirectory(() => entries)
    const client = createLdapClient({ settings: OPENLDAP, bindPassword: 'pw', connect: dir.factory })
    expect((await client.findLoginUser('ada@example.com'))?.dn).toBe('uid=ada,ou=people,dc=example,dc=com')
    await client.findLoginUser('*)(uid=*')
    const last = dir.calls.filter((c) => c.op === 'search').at(-1)!
    expect(last.options!.filter).toBe('(&(objectClass=inetOrgPerson)(|(mail=\\2a\\29\\28uid=\\2a)(uid=\\2a\\29\\28uid=\\2a)))')
    expect(last.options!.sizeLimit).toBe(2)
    entries = [entries[0], { ...entries[0], dn: 'uid=ada2,ou=people,dc=example,dc=com' }]
    expect(await client.findLoginUser('ada@example.com')).toBeNull()
    expect(await client.findLoginUser('   ')).toBeNull()
  })

  it('verifies passwords with a bind as the user, refusing empty passwords before the server', async () => {
    const invalid = Object.assign(new Error('Invalid Credentials'), { name: 'InvalidCredentialsError', code: 49 })
    const dir = fakeDirectory(() => [], { bindError: (_dn, pw) => (pw === 'right' ? null : invalid) })
    const settings = OPENLDAP
    expect(await verifyLdapPassword({ settings, dn: 'uid=ada', password: 'right', connect: dir.factory })).toBe(true)
    expect(await verifyLdapPassword({ settings, dn: 'uid=ada', password: 'wrong', connect: dir.factory })).toBe(false)
    const before = dir.calls.length
    expect(await verifyLdapPassword({ settings, dn: 'uid=ada', password: '', connect: dir.factory })).toBe(false)
    expect(dir.calls.length).toBe(before) // never reached the server
    // Every connection is closed.
    expect(dir.calls.filter((c) => c.op === 'unbind').length).toBe(2)
  })

  it('reports bind and TLS failures distinctly', async () => {
    const badBind = fakeDirectory(() => [], { bindError: () => Object.assign(new Error('Invalid Credentials'), { name: 'InvalidCredentialsError' }) })
    await expect(createLdapClient({ settings: AD, bindPassword: 'x', connect: badBind.factory }).listUsers())
      .rejects.toMatchObject({ code: 'invalid_credentials', message: expect.stringContaining('service account') })
    const badTls = fakeDirectory(() => [], { bindError: () => Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) })
    await expect(createLdapClient({ settings: AD, bindPassword: 'x', connect: badTls.factory }).listUsers()).rejects.toMatchObject({ code: 'tls' })
  })

  it('warns about plaintext and unverified connections in the test result', async () => {
    const dir = fakeDirectory((base, options) => (base === 'dc=example,dc=com' && options.scope === 'base' ? [{ dn: 'dc=example,dc=com' }] : []))
    const plain = await createLdapClient({ settings: { ...OPENLDAP, start_tls: false }, bindPassword: 'pw', connect: dir.factory }).test()
    expect(plain.encrypted).toBe(false)
    expect(plain.warnings.join(' ')).toMatch(/not encrypted/)
    expect(plain.warnings.join(' ')).toMatch(/matched no entries/)
    const unverified = await createLdapClient({ settings: { ...OPENLDAP, tls_reject_unauthorized: false }, bindPassword: 'pw', connect: dir.factory }).test()
    expect(unverified.warnings.join(' ')).toMatch(/Certificate verification is off/)
  })

  it('refuses private and metadata hosts unless private egress is allowed', async () => {
    delete process.env.ALLOW_PRIVATE_EGRESS
    const dir = fakeDirectory(() => [])
    await expect(createLdapClient({ settings: { ...OPENLDAP, url: 'ldap://10.0.0.5:389' }, bindPassword: 'pw', connect: dir.factory }).listUsers()).rejects.toThrow(/not allowed/)
    await expect(createLdapClient({ settings: { ...OPENLDAP, url: 'ldap://169.254.169.254' }, bindPassword: 'pw', connect: dir.factory }).listUsers()).rejects.toThrow(/metadata/)
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    await expect(createLdapClient({ settings: { ...OPENLDAP, url: 'ldap://169.254.169.254' }, bindPassword: 'pw', connect: dir.factory }).listUsers()).rejects.toThrow(/metadata/)
    expect(dir.factoryOptions).toHaveLength(0)
  })
})
