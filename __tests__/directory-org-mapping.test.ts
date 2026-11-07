import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEntraClient, entraProfile } from '@/lib/directory-sync/entra'
import { oktaProfile } from '@/lib/directory-sync/okta'
import { googleProfile } from '@/lib/directory-sync/google'
import { entryToUser, resolveLdapSettings } from '@/lib/directory-sync/ldap'
import { scimProfile } from '@/lib/scim/store'
import { planProfileChange, planProfileChanges, unitPathFor, unitPathMode, type MembershipProfile } from '@/lib/directory-sync/profiles'
import { orgToggle } from '@/lib/directory-sync/connection'
import type { DirectoryUser } from '@/lib/directory-sync/types'

/**
 * Directory sync → org structure: what each provider maps (job title,
 * department, division, company, location, employee id, cost centre, Google
 * org unit path), the attribute write rules (directory vs manual vs never
 * set) and the per-connection toggle defaults.
 */

afterEach(() => { vi.unstubAllGlobals() })

describe('provider attribute mapping', () => {
  it('Entra ID: Graph properties, employeeOrgData for division / cost centre', () => {
    expect(entraProfile({
      jobTitle: ' Engineer ', department: 'Platform', officeLocation: 'Wellington', employeeId: 'E7', companyName: 'Acme',
      employeeOrgData: { division: 'Technology', costCenter: 'CC-9' },
    })).toEqual({ job_title: 'Engineer', department: 'Platform', location: 'Wellington', employee_id: 'E7', company: 'Acme', division: 'Technology', cost_center: 'CC-9' })
    // Unset properties are null: the directory has no value.
    expect(entraProfile({ jobTitle: null })).toEqual({ job_title: null, department: null, location: null, employee_id: null, company: null, division: null, cost_center: null })
  })

  it('Entra ID: listUsers selects the org properties and maps them', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url))
      if (String(url).includes('/oauth2/')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
      return new Response(JSON.stringify({ value: [{ id: 'u1', displayName: 'Ada', mail: 'ada@x.test', accountEnabled: true, jobTitle: 'CTO', department: 'Eng' }] }), { status: 200 })
    }))
    const [user] = await createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 's' }).listUsers()
    expect(decodeURIComponent(urls[1])).toContain('jobTitle,department,officeLocation,employeeId,companyName,employeeOrgData')
    expect(user.profile).toMatchObject({ job_title: 'CTO', department: 'Eng', location: null })
  })

  it('Okta: title, department, division, organization, costCenter, employeeNumber, location', () => {
    expect(oktaProfile({ title: 'PM', department: 'Product', division: 'R&D', organization: 'Acme', costCenter: '42', employeeNumber: '1001', city: 'Auckland' }))
      .toEqual({ job_title: 'PM', department: 'Product', division: 'R&D', company: 'Acme', cost_center: '42', employee_id: '1001', location: 'Auckland' })
    expect(oktaProfile({ officeLocation: 'HQ L3', city: 'Auckland' }).location).toBe('HQ L3')
  })

  it('Google Workspace: primary organization, desk location, organization external id', () => {
    expect(googleProfile({
      organizations: [{ title: 'Old', department: 'Old' }, { primary: true, title: 'Designer', department: 'Design', costCenter: 'D1', name: 'Acme' }],
      locations: [{ type: 'desk', buildingId: 'HQ' }],
      externalIds: [{ type: 'custom', value: 'x' }, { type: 'organization', value: 'G-9' }],
    })).toEqual({ job_title: 'Designer', department: 'Design', cost_center: 'D1', company: 'Acme', location: 'HQ', employee_id: 'G-9' })
  })

  it('LDAP / AD: preset attributes; unmapped keys are left out', () => {
    const ad = resolveLdapSettings({ url: 'ldaps://dc', bind_dn: 'x', base_dn: 'DC=x', flavor: 'active_directory' })
    const user = entryToUser({
      dn: 'CN=Ada,DC=x', objectGUID: 'g1', mail: 'ada@x.test', title: 'Lead', department: 'Eng', physicalDeliveryOfficeName: 'Room 4',
      employeeID: '77', company: 'Acme',
    }, ad)
    expect(user.profile).toEqual({ job_title: 'Lead', department: 'Eng', location: 'Room 4', employee_id: '77', company: 'Acme', division: null })
    // A custom mapping, e.g. cost centre from extensionAttribute1.
    const custom = resolveLdapSettings({ url: 'ldaps://dc', bind_dn: 'x', base_dn: 'DC=x', flavor: 'active_directory', attributes: { cost_center: 'extensionAttribute1' } })
    expect(entryToUser({ dn: 'CN=B,DC=x', extensionAttribute1: 'CC1' }, custom).profile?.cost_center).toBe('CC1')
    const openldap = resolveLdapSettings({ url: 'ldap://l', bind_dn: 'x', base_dn: 'dc=x', flavor: 'openldap' })
    expect(entryToUser({ dn: 'uid=a,dc=x', departmentNumber: '12', o: 'Acme' }, openldap).profile).toMatchObject({ department: '12', company: 'Acme', job_title: null })
  })

  it('SCIM: core title, work address locality, enterprise extension', () => {
    expect(scimProfile({
      title: 'Analyst',
      addresses: [{ type: 'home', locality: 'Home' }, { type: 'work', locality: 'Sydney' }],
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'Finance', division: 'Corp', organization: 'Acme', costCenter: 'F1', employeeNumber: '5' },
    })).toEqual({ job_title: 'Analyst', location: 'Sydney', department: 'Finance', division: 'Corp', company: 'Acme', cost_center: 'F1', employee_id: '5' })
    // No extension / no addresses: those fields are not mentioned (nothing changes).
    expect(scimProfile({ title: 'X' })).toEqual({ job_title: 'X' })
  })
})

describe('attribute write rules', () => {
  const blank: MembershipProfile = { job_title: null, department: null, location: null, employee_id: null, cost_center: null, profile_source: null }

  it('fills never-set attributes and changes only what differs', () => {
    expect(planProfileChange({ job_title: 'Eng', department: 'Platform', location: null }, blank)).toEqual({ job_title: 'Eng', department: 'Platform' })
    expect(planProfileChange({ job_title: 'Eng' }, { ...blank, job_title: 'Eng', profile_source: 'directory' })).toBeNull()
  })

  it('leaves detached (manual) attributes alone', () => {
    expect(planProfileChange({ job_title: 'Eng' }, { ...blank, job_title: 'Boss', profile_source: 'manual' })).toBeNull()
  })

  it('null clears only directory-owned values; absent fields are untouched', () => {
    expect(planProfileChange({ job_title: null }, { ...blank, job_title: 'Eng', profile_source: 'directory' })).toEqual({ job_title: null })
    expect(planProfileChange({ job_title: null }, { ...blank, job_title: 'Eng', profile_source: null })).toBeNull()
    expect(planProfileChange({ department: 'X' }, { ...blank, job_title: 'Eng', profile_source: 'directory' })).toEqual({ department: 'X' })
  })

  it('truncates to the column limits', () => {
    expect(planProfileChange({ employee_id: 'x'.repeat(150) }, blank)?.employee_id).toHaveLength(100)
  })

  it('plans per linked active member only', () => {
    const users: DirectoryUser[] = [
      { externalId: 'a', displayName: 'A', email: null, active: true, profile: { job_title: 'Eng' } },
      { externalId: 'b', displayName: 'B', email: null, active: false, profile: { job_title: 'Eng' } },
      { externalId: 'c', displayName: 'C', email: null, active: true, profile: { job_title: 'Eng' } }, // not linked
      { externalId: 'd', displayName: 'D', email: null, active: true }, // provider said nothing
    ]
    const changes = planProfileChanges({
      users,
      localIdByExternalId: new Map([['a', 'u-a'], ['b', 'u-b'], ['d', 'u-d']]),
      current: new Map([['u-a', blank], ['u-b', blank], ['u-d', blank]]),
    })
    expect(changes).toEqual([{ user_id: 'u-a', updates: { job_title: 'Eng' } }])
  })
})

describe('org unit paths', () => {
  const u = (extra: Partial<DirectoryUser>): DirectoryUser => ({ externalId: 'x', displayName: 'X', email: null, active: true, ...extra })

  it('company → division → department for pull directories and SCIM', () => {
    expect(unitPathFor(u({ profile: { company: 'Acme', division: 'Ops', department: 'Finance' } }), 'attributes'))
      .toEqual([{ kind: 'company', name: 'Acme' }, { kind: 'division', name: 'Ops' }, { kind: 'department', name: 'Finance' }])
    expect(unitPathFor(u({}), 'attributes')).toBeNull()
    expect(unitPathFor(u({ profile: { job_title: 'x' } }), 'attributes')).toEqual([])
  })

  it('Google: the OU tree when anyone is below the root, else departments', () => {
    const inOu = u({ orgUnitPath: '/Engineering/Web', profile: { department: 'Web' } })
    const atRoot = u({ orgUnitPath: '/', profile: { department: 'Sales' } })
    expect(unitPathMode([inOu, atRoot])).toBe('org_unit_path')
    expect(unitPathFor(inOu, 'org_unit_path')).toEqual([{ kind: 'unit', name: 'Engineering' }, { kind: 'unit', name: 'Web' }])
    expect(unitPathFor(atRoot, 'org_unit_path')).toEqual([])
    expect(unitPathMode([atRoot])).toBe('attributes')
  })
})

describe('connection toggles', () => {
  it('new connector rows default on; stored rows keep their value; absent stays absent (off)', () => {
    expect(orgToggle('import_org_units', undefined, {}, true)).toEqual({ import_org_units: true })
    expect(orgToggle('import_org_units', undefined, {}, false)).toEqual({})
    expect(orgToggle('import_profiles', undefined, { import_profiles: true }, false)).toEqual({ import_profiles: true })
    expect(orgToggle('import_profiles', false, {}, true)).toEqual({ import_profiles: false })
  })
})
