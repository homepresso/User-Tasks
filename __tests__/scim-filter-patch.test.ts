import { describe, expect, it } from 'vitest'
import { ScimError } from '@/lib/scim/errors'
import { indexableEquality, matchesFilter, parseAttrPath, parseFilter } from '@/lib/scim/filter'
import { applyPatch, memberChanges, parsePatchRequest } from '@/lib/scim/patch'

/* eslint-disable @typescript-eslint/no-explicit-any -- patched resources are free-form JSON */

/**
 * SCIM filter (RFC 7644 §3.4.2.2) and PATCH (§3.5.2) semantics, including
 * the request shapes Microsoft Entra ID's and Okta's SCIM validators send.
 */

const user = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  id: '2819c223-7f76-453a-919d-413861904646',
  externalId: 'Ext-1',
  userName: 'Bjensen@Example.com',
  name: { givenName: 'Barbara', familyName: 'Jensen', formatted: 'Ms. Barbara J Jensen III' },
  displayName: 'Babs Jensen',
  active: true,
  emails: [
    { value: 'bjensen@example.com', type: 'work', primary: true },
    { value: 'babs@jensen.org', type: 'home' },
  ],
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { employeeNumber: '701984', department: 'Tour Operations' },
  meta: { lastModified: '2026-10-01T10:00:00.000Z', resourceType: 'User' },
}

const match = (filter: string, resource: Record<string, unknown> = user) => matchesFilter(resource, parseFilter(filter))

describe('SCIM filters', () => {
  it.each([
    ['userName eq "bjensen@example.com"', true], // userName is case-insensitive
    ['USERNAME EQ "BJENSEN@EXAMPLE.COM"', true], // so are attribute names and operators
    ['userName ne "someone"', true],
    ['userName co "jensen"', true],
    ['userName sw "bj"', true],
    ['userName ew "example.com"', true],
    ['externalId eq "ext-1"', false], // externalId is case-exact
    ['externalId eq "Ext-1"', true],
    ['name.familyName eq "jensen"', true],
    ['emails.value eq "babs@jensen.org"', true],
    ['emails eq "babs@jensen.org"', true], // a multi-valued attribute compares its value
    ['emails[type eq "work" and value co "@example.com"]', true],
    ['emails[type eq "home" and value co "@example.com"]', false],
    ['title pr', false],
    ['displayName pr', true],
    ['active eq true', true],
    ['active eq false', false],
    ['meta.lastModified gt "2026-09-01T00:00:00Z"', true],
    ['meta.lastModified lt "2026-09-01T00:00:00Z"', false],
    ['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber eq "701984"', true],
    ['urn:ietf:params:scim:schemas:core:2.0:User:userName eq "bjensen@example.com"', true],
    ['userName eq "x" or displayName eq "Babs Jensen"', true],
    ['userName eq "x" or displayName eq "y" and active eq true', false], // and binds tighter
    ['(userName eq "x" or displayName eq "Babs Jensen") and active eq true', true],
    ['not (userName eq "bjensen@example.com")', false],
    ['userName eq "with \\"quotes\\""', false],
  ])('%s → %s', (filter, expected) => {
    expect(match(filter)).toBe(expected)
  })

  it('evaluates Entra\'s group membership probe (id eq … and members[value eq …])', () => {
    const group = { id: 'g1', displayName: 'Sales', members: [{ value: 'u1' }, { value: 'u2' }] }
    expect(match('id eq "g1" and members[value eq "u2"]', group)).toBe(true)
    expect(match('id eq "g1" and members[value eq "u3"]', group)).toBe(false)
  })

  it.each([
    'userName eq',
    'userName xx "a"',
    '(userName eq "a"',
    'userName eq "a" junk',
    'userName eq unquoted',
    'emails[type eq "work"',
    '"value"',
    'user$name! eq "a"',
  ])('rejects %s with 400 invalidFilter', (filter) => {
    try {
      parseFilter(filter)
      throw new Error('parsed')
    } catch (error) {
      expect(error).toBeInstanceOf(ScimError)
      expect((error as ScimError).status).toBe(400)
      expect((error as ScimError).scimType).toBe('invalidFilter')
    }
  })

  it('caps filter length and nesting', () => {
    expect(() => parseFilter(`userName eq "${'a'.repeat(5000)}"`)).toThrow(/too long/)
    expect(() => parseFilter(`${'('.repeat(40)}userName eq "a"${')'.repeat(40)}`)).toThrow(/nested too deeply/)
  })

  it('finds an indexed equality at the root or in an AND branch only', () => {
    expect(indexableEquality(parseFilter('userName eq "a"'), ['userName'])).toEqual({ attr: 'userName', value: 'a' })
    expect(indexableEquality(parseFilter('active eq true and externalId eq "x"'), ['userName', 'externalId'])).toEqual({ attr: 'externalId', value: 'x' })
    expect(indexableEquality(parseFilter('userName eq "a" or userName eq "b"'), ['userName'])).toBeNull()
    expect(indexableEquality(parseFilter('userName co "a"'), ['userName'])).toBeNull()
  })

  it('parses attribute paths with schema URNs', () => {
    expect(parseAttrPath('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager.value'))
      .toEqual({ urn: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User', attr: 'manager', sub: 'value' })
    expect(parseAttrPath('urn:ietf:params:scim:schemas:core:2.0:User:name.givenName')).toEqual({ urn: null, attr: 'name', sub: 'givenName' })
  })
})

const patch = (resource: Record<string, unknown>, operations: unknown[]) =>
  applyPatch(resource, parsePatchRequest({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: operations }))

describe('SCIM PATCH', () => {
  it('Entra: Replace without a path, booleans as strings, capitalised op names', () => {
    const out = patch(user, [{ op: 'Replace', value: { active: 'False' } }])
    expect(out.active).toBe(false)
    expect(patch(user, [{ op: 'replace', path: 'active', value: 'True' }]).active).toBe(true)
  })

  it('Entra: dotted and URN-qualified keys in a no-path value', () => {
    const out = patch(user, [{
      op: 'Add',
      value: {
        'name.givenName': 'Barb',
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department': 'R&D',
      },
    }]) as any
    expect(out.name.givenName).toBe('Barb')
    expect(out.name.familyName).toBe('Jensen')
    expect(out['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'].department).toBe('R&D')
    expect(out['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'].employeeNumber).toBe('701984')
  })

  it('Entra: replace on emails[type eq "work"].value updates the element, and creates it when missing', () => {
    const updated = patch(user, [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'new@example.com' }]) as any
    expect(updated.emails[0]).toEqual({ value: 'new@example.com', type: 'work', primary: true })
    const created = patch({ userName: 'x' }, [{ op: 'Add', path: 'emails[type eq "work"].value', value: 'x@example.com' }]) as any
    expect(created.emails).toEqual([{ type: 'work', value: 'x@example.com' }])
  })

  it('Entra: replace userName, add a whole extension object, remove an attribute', () => {
    const out = patch(user, [
      { op: 'replace', path: 'userName', value: 'renamed@example.com' },
      { op: 'add', value: { 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { costCenter: '42' } } },
      { op: 'remove', path: 'displayName' },
    ]) as any
    expect(out.userName).toBe('renamed@example.com')
    expect(out['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'].costCenter).toBe('42')
    expect(out['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'].department).toBe('Tour Operations')
    expect(out.displayName).toBeUndefined()
  })

  it('Okta: replace with an object value carrying id and active ignores read-only keys', () => {
    const out = patch(user, [{ op: 'replace', value: { id: 'other', active: false } }]) as any
    expect(out.id).toBe(user.id)
    expect(out.active).toBe(false)
  })

  it('add on a multi-valued attribute appends without duplicates; remove with a filter drops matches', () => {
    const added = patch(user, [{ op: 'add', path: 'emails', value: [{ value: 'babs@jensen.org', type: 'home' }, { value: 'third@x.org', type: 'other' }] }]) as any
    expect(added.emails.map((e: any) => e.value)).toEqual(['bjensen@example.com', 'babs@jensen.org', 'third@x.org'])
    const removed = patch(user, [{ op: 'remove', path: 'emails[type eq "home"]' }]) as any
    expect(removed.emails.map((e: any) => e.value)).toEqual(['bjensen@example.com'])
  })

  it('members: Entra remove with a value array, Okta remove with a filter path, add deduplicates', () => {
    const group = { displayName: 'G', members: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] }
    expect((patch(group, [{ op: 'Remove', path: 'members', value: [{ value: 'b' }] }]) as any).members).toEqual([{ value: 'a' }, { value: 'c' }])
    expect((patch(group, [{ op: 'remove', path: 'members[value eq "a"]' }]) as any).members).toEqual([{ value: 'b' }, { value: 'c' }])
    expect((patch(group, [{ op: 'add', path: 'members', value: [{ value: 'a' }, { value: 'd' }] }]) as any).members.map((m: any) => m.value)).toEqual(['a', 'b', 'c', 'd'])
    expect((patch(group, [{ op: 'remove', path: 'members' }]) as any).members).toBeUndefined()
  })

  it('memberChanges recognises members-only operations', () => {
    const ops = (operations: unknown[]) => parsePatchRequest({ Operations: operations })
    expect(memberChanges(ops([{ op: 'Add', path: 'members', value: [{ value: 'u1' }, { value: 'u2' }] }]))).toEqual({ add: ['u1', 'u2'], remove: [], replace: null })
    expect(memberChanges(ops([{ op: 'Remove', path: 'members', value: [{ value: 'u1' }] }]))).toEqual({ add: [], remove: ['u1'], replace: null })
    expect(memberChanges(ops([{ op: 'remove', path: 'members[value eq "u9"]' }]))).toEqual({ add: [], remove: ['u9'], replace: null })
    expect(memberChanges(ops([{ op: 'replace', path: 'members', value: [{ value: 'u3' }] }]))).toEqual({ add: [], remove: [], replace: ['u3'] })
    expect(memberChanges(ops([{ op: 'add', value: { members: [{ value: 'u4' }] } }]))).toEqual({ add: ['u4'], remove: [], replace: null })
    expect(memberChanges(ops([{ op: 'replace', path: 'displayName', value: 'X' }]))).toBeNull()
  })

  it('rejects malformed PatchOp bodies', () => {
    expect(() => parsePatchRequest({})).toThrow(ScimError)
    expect(() => parsePatchRequest({ Operations: [] })).toThrow(/non-empty/)
    expect(() => parsePatchRequest({ Operations: [{ op: 'move', path: 'a' }] })).toThrow(/Unknown PATCH op/)
    expect(() => parsePatchRequest({ Operations: [{ op: 'remove' }] })).toThrow(/needs a path/)
    expect(() => patch(user, [{ op: 'replace', path: 'emails[type eq "work"', value: 'x' }])).toThrow(ScimError)
    expect(() => patch(user, [{ op: 'replace', value: 'not an object' }])).toThrow(/object value/)
    expect(() => parsePatchRequest({ Operations: Array.from({ length: 1001 }, () => ({ op: 'add', path: 'a', value: 1 })) })).toThrow(/At most/)
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(user)
    patch(user, [{ op: 'replace', path: 'displayName', value: 'X' }, { op: 'remove', path: 'emails[type eq "home"]' }])
    expect(JSON.stringify(user)).toBe(before)
  })
})
