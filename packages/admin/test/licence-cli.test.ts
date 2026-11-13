import { describe, expect, it } from 'vitest'
import { parseCommand, UsageError } from '../src/cli'
import { licenceStatusLine, parseLimits, runEntitlements, runLicence, type LicenceCliStore, type LicenceIO } from '../src/licence-cli'
import type { TenantEntitlementRow } from '@/lib/licensing/types'
import { makeLicence, throwawayKey } from '../../../__tests__/helpers/licence-fixtures'

/**
 * usertasks-admin licence status | install | remove | request and
 * entitlements list | grant | revoke, over an in-memory store (the SQL store
 * is the same instance_settings / tenant_entitlements code the other
 * commands use).
 */

const KEY = throwawayKey('test-1')
const OTHER = throwawayKey('test-2')
const NOW = () => new Date('2027-01-01T00:00:00Z')
const TENANT = '11111111-2222-4333-8444-555555555555'

function memoryStore() {
  const settings = new Map<string, unknown>()
  const rows: TenantEntitlementRow[] = []
  const events: string[] = []
  const store: LicenceCliStore = {
    readSetting: async (k) => settings.get(k),
    writeSetting: async (k, v) => { settings.set(k, v) },
    ensureInstanceId: async () => {
      if (!settings.has('instance.id')) settings.set('instance.id', 'inst_clitest00000000000000000')
      return settings.get('instance.id') as string
    },
    listEntitlements: async (f) => rows.filter((r) => (!f.tenantId || r.tenant_id === f.tenantId) && (!f.extensionId || r.extension_id === f.extensionId)),
    upsertEntitlement: async (row) => {
      const i = rows.findIndex((r) => r.tenant_id === row.tenant_id && r.extension_id === row.extension_id)
      if (i >= 0) rows[i] = row
      else rows.push(row)
    },
    deleteEntitlement: async (t, e) => {
      const i = rows.findIndex((r) => r.tenant_id === t && r.extension_id === e)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
    recordEvent: async (e) => { events.push(`${e.event}:${e.licence_id ?? e.extension_id}`) },
  }
  return { store, settings, rows, events }
}

function io(env: NodeJS.ProcessEnv = { APP_URL: 'https://usertasks.corp.example' }): LicenceIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, env, out: (l) => lines.push(l), err: (l) => errors.push(l) }
}

const deps = (files: Record<string, string> = {}, written: Record<string, string> = {}) => ({
  now: NOW,
  keyring: [KEY.entry],
  readFile: async (f: string) => {
    const hit = Object.entries(files).find(([name]) => f.endsWith(name))
    if (!hit) throw new Error('ENOENT')
    return hit[1]
  },
  writeFile: async (f: string, t: string) => { written[f] = t },
})

describe('usertasks-admin licence: parsing', () => {
  it('parses the commands (and the US spelling)', () => {
    expect(parseCommand(['licence'], {}).command).toEqual({ kind: 'licence', action: 'status', args: [] })
    expect(parseCommand(['license', 'install', 'a.licence'], {}).command).toEqual({ kind: 'licence', action: 'install', args: ['a.licence'] })
    expect(parseCommand(['licence', 'remove', '--all'], {}).values.all).toBe(true)
    expect(parseCommand(['licence', 'request', '--out', 'r.json'], {}).values.out).toBe('r.json')
    expect(parseCommand(['entitlements', 'grant', '--tenant', TENANT, '--ext', 'sharepoint', '--limits', 'sharepoint.farms=2'], {}).command).toEqual({ kind: 'entitlements', action: 'grant' })
  })

  it('rejects bad input', () => {
    for (const argv of [
      ['licence', 'frob'],
      ['licence', 'install'],
      ['licence', 'remove'],
      ['licence', 'remove', 'a', '--all'],
      ['licence', 'status', 'x'],
      ['licence', 'status', '--all'],
      ['entitlements', 'grant', '--tenant', TENANT],
      ['entitlements', 'nuke'],
    ]) expect(() => parseCommand(argv, {}), argv.join(' ')).toThrow(UsageError)
  })

  it('parses --limits', () => {
    expect(parseLimits('sharepoint.farms=2, sharepoint.active_users=500')).toEqual({ 'sharepoint.farms': 2, 'sharepoint.active_users': 500 })
    expect(() => parseLimits('farms')).toThrow()
    expect(() => parseLimits('farms=-1')).toThrow()
  })
})

describe('usertasks-admin licence: commands', () => {
  it('install → status → remove', async () => {
    const m = memoryStore()
    const files = { 'good.licence': JSON.stringify(makeLicence(KEY.pem, 'test-1')) }
    const out = io()
    expect(await runLicence('install', ['good.licence'], { actor: 'ops' }, m.store, out, deps(files))).toBe(0)
    expect(out.lines[0]).toBe('Installed licence lic_test_1.')
    expect(m.settings.get('instance.licences')).toHaveLength(1)

    const status = io()
    expect(await runLicence('status', [], { actor: 'ops' }, m.store, status, deps())).toBe(0)
    expect(status.lines.join('\n')).toMatch(/Instance id: inst_clitest/)
    expect(status.lines.join('\n')).toMatch(/limit\s+sharepoint\.farms = 2/)
    expect(status.lines.join('\n')).toMatch(/stops at\s+2027-11-02 00:00 UTC/)

    const json = io()
    await runLicence('status', [], { json: true, actor: 'ops' }, m.store, json, deps())
    expect(JSON.parse(json.lines[0]).licences[0]).toMatchObject({ licenceId: 'lic_test_1', valid: true, timeState: 'active' })

    const line = await licenceStatusLine(m.store, {}, deps())
    expect(line.line).toMatch(/1 installed, 1 usable \(sharepoint\)/)

    const rm = io()
    expect(await runLicence('remove', ['lic_nope'], { actor: 'ops' }, m.store, rm, deps())).toBe(1)
    expect(await runLicence('remove', ['lic_test_1'], { actor: 'ops' }, m.store, rm, deps())).toBe(0)
    expect(m.settings.get('instance.licences')).toEqual([])
    expect(m.events).toEqual(['installed:lic_test_1', 'removed:lic_test_1'])
  })

  it('refuses foreign / tampered licences and reports invalid ones from the environment', async () => {
    const m = memoryStore()
    const files = {
      'foreign.licence': JSON.stringify(makeLicence(OTHER.pem, 'test-2')),
      'tampered.licence': JSON.stringify({ ...makeLicence(KEY.pem, 'test-1'), limits: { 'sharepoint.farms': 50 } }),
    }
    for (const f of Object.keys(files)) {
      const out = io()
      expect(await runLicence('install', [f], { actor: 'ops' }, m.store, out, deps(files))).toBe(1)
      expect(out.errors[0]).toMatch(/Licence not installed/)
    }
    expect(await runLicence('install', ['missing.licence'], { actor: 'ops' }, m.store, io(), deps(files))).toBe(1)
    expect(m.settings.get('instance.licences')).toBeUndefined()

    const status = io({ USERTASKS_LICENCE: files['foreign.licence'] })
    expect(await runLicence('status', [], { actor: 'ops' }, m.store, status, deps())).toBe(1)
    expect(status.lines.join('\n')).toMatch(/INVALID/)
  })

  it('request writes the activation request file', async () => {
    const m = memoryStore()
    const written: Record<string, string> = {}
    const out = io()
    expect(await runLicence('request', [], { out: '/tmp/req.json', actor: 'ops' }, m.store, out, deps({}, written))).toBe(0)
    const request = JSON.parse(written['/tmp/req.json'])
    expect(request).toMatchObject({ kind: 'usertasks.licence_request', instance_id: 'inst_clitest00000000000000000', hostnames: ['usertasks.corp.example'], deployment_mode: 'self_hosted' })
    const json = io()
    await runLicence('request', [], { json: true, actor: 'ops' }, m.store, json, deps())
    expect(JSON.parse(json.lines.join('\n')).kind).toBe('usertasks.licence_request')
  })
})

describe('usertasks-admin entitlements', () => {
  it('grant → list → revoke', async () => {
    const m = memoryStore()
    const out = io()
    expect(await runEntitlements('grant', { tenant: TENANT, ext: 'sharepoint', until: '2027-12-31T00:00:00Z', limits: 'sharepoint.farms=2', features: 'connector,importers', actor: 'ops' }, m.store, out)).toBe(0)
    expect(m.rows[0]).toMatchObject({ tenant_id: TENANT, extension_id: 'sharepoint', status: 'active', source: 'admin', limits: { 'sharepoint.farms': 2 }, features: ['connector', 'importers'], ends_at: '2027-12-31T00:00:00.000Z' })
    const list = io()
    await runEntitlements('list', { json: true, actor: 'ops' }, m.store, list)
    expect(JSON.parse(list.lines[0])).toHaveLength(1)
    expect(await runEntitlements('revoke', { tenant: TENANT, ext: 'sharepoint', actor: 'ops' }, m.store, io())).toBe(0)
    expect(await runEntitlements('revoke', { tenant: TENANT, ext: 'sharepoint', actor: 'ops' }, m.store, io())).toBe(1)
    expect(m.events).toEqual(['entitlement_granted:sharepoint', 'entitlement_revoked:sharepoint'])
  })

  it('validates input', async () => {
    const m = memoryStore()
    expect(await runEntitlements('grant', { tenant: 'nope', ext: 'sharepoint', actor: 'ops' }, m.store, io())).toBe(2)
    expect(await runEntitlements('grant', { tenant: TENANT, ext: 'SharePoint!', actor: 'ops' }, m.store, io())).toBe(2)
    expect(await runEntitlements('grant', { tenant: TENANT, ext: 'sharepoint', until: 'soon', actor: 'ops' }, m.store, io())).toBe(2)
    expect(await runEntitlements('grant', { tenant: TENANT, ext: 'sharepoint', limits: 'x', actor: 'ops' }, m.store, io())).toBe(2)
    expect(m.rows).toEqual([])
  })
})
