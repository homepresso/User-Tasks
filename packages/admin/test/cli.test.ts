import { describe, expect, it } from 'vitest'
import { parseCommand, run, UsageError, type CliIO } from '../src/cli'
import { checkBootstrapInput } from '../src/bootstrap'
import { plannedSettings } from '@/lib/admin/switch/engine'
import { changedSettingKeys, encodeSetting, maskUrl } from '../src/instance'
import { resolveInstanceConfig } from '@/lib/config'
import { PROVIDER_AREAS } from '@/lib/config/schema'

function io(env: NodeJS.ProcessEnv = {}): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, env, out: (l) => lines.push(l), err: (l) => errors.push(l) }
}

describe('usertasks-admin argument parsing', () => {
  it('rejects bad input with usage errors', () => {
    const bad = [
      ['doctor', '--area', 'files'],
      ['history', '--limit', 'ten'],
      ['instance-admins', 'add', 'not-an-email'],
      ['frobnicate'],
      ['status', '--unknown-flag'],
    ]
    for (const argv of bad) expect(() => parseCommand(argv, {}), argv.join(' ')).toThrow(UsageError)
  })

  it('run(): help, usage errors (exit 2) and commands that need a database', async () => {
    const help = io()
    expect(await run(['--help'], help)).toBe(0)
    expect(help.lines.join('\n')).toMatch(/usertasks-admin switch <area> --to <provider> …\s+\(Infrastructure add-on/)

    for (const argv of [['history']]) {
      const noDb = io({})
      expect(await run(argv, noDb), argv.join(' ')).toBe(2)
      expect(noDb.errors.join('\n')).toMatch(/DATABASE_URL/)
    }
  })

  it('providers list filters the catalogue', async () => {
    const all = io()
    expect(await run(['providers', 'list', '--json'], all)).toBe(0)
    const entries = JSON.parse(all.lines.join('\n')) as Array<{ area: string; id: string; onPrem: boolean; azure: boolean }>
    expect(entries.length).toBeGreaterThan(20)
    const onPrem = io()
    await run(['providers', 'list', '--on-prem', '--json'], onPrem)
    const list = JSON.parse(onPrem.lines.join('\n')) as typeof entries
    expect(list.every((e) => e.onPrem)).toBe(true)
    expect(list.some((e) => e.area === 'storage' && e.id === 'local')).toBe(true)
    expect(list.some((e) => e.id === 'azure_blob')).toBe(false)
    const azure = io()
    await run(['providers', 'list', '--azure', '--area', 'storage'], azure)
    expect(azure.lines.join('\n')).toMatch(/azure_blob/)
    expect(azure.lines.join('\n')).not.toMatch(/\bgcs\b/)
  })
})

describe('switch / rollback without the Infrastructure add-on', () => {
  it('refuse with a clear message (exit 2) and never touch the database', async () => {
    for (const argv of [['switch', 'storage', '--to', 'local', '--yes'], ['switch', 'database', '--to', 'postgres', '--target-url', 'postgres://x/y'], ['rollback', '00000000-0000-0000-0000-000000000000', '--yes']]) {
      const out = io({ DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none' })
      expect(await run(argv, out), argv.join(' ')).toBe(2)
      const text = out.errors.join('\n')
      expect(text).toMatch(/part of the Infrastructure add-on, a paid extension/)
      expect(text).toMatch(/keeps running on its current providers/)
      expect(text).toMatch(/Settings → Extensions and Settings → Licence/)
      expect(text).not.toMatch(/ECONNREFUSED|connect/i)
    }
  })
})

describe('settings helpers', () => {
  it('plans the provider setting, or an env change when the provider is env-managed', () => {
    const saved = process.env.STORAGE_PROVIDER
    delete process.env.STORAGE_PROVIDER
    const config = resolveInstanceConfig(new Map())
    if (saved !== undefined) process.env.STORAGE_PROVIDER = saved
    const options = { to: 'local', set: { local_root: '/data' }, secret: {} } as never
    const planned = plannedSettings({ area: 'storage', to: 'local', options, config }, { writesProviderSetting: true })
    expect(planned.rows.map((r) => [r.key, r.value])).toEqual([['providers.storage', 'local'], ['storage.local_root', '/data']])
    expect(planned.env).toEqual({})

    const envConfig = { ...config, providers: { ...config.providers, storage: { ...config.providers.storage, source: 'env' as const } } }
    const envPlanned = plannedSettings({ area: 'storage', to: 'local', options, config: envConfig }, { writesProviderSetting: true })
    expect(envPlanned.env).toEqual({ STORAGE_PROVIDER: 'local' })
    expect(envPlanned.rows.map((r) => r.key)).toEqual(['storage.local_root'])

    // The database is bootstrap config: never an instance setting.
    const dbPlanned = plannedSettings({ area: 'db', to: 'postgres', options: { to: 'postgres', set: {}, secret: {} } as never, config }, { writesProviderSetting: false })
    expect(dbPlanned.rows).toEqual([])
  })

  it('refuses to store a secret option without ENCRYPTION_KEY, and validates keys', () => {
    const saved = process.env.ENCRYPTION_KEY
    delete process.env.ENCRYPTION_KEY
    try {
      expect(() => encodeSetting('storage.secret_access_key', 'x', true)).toThrow(/ENCRYPTION_KEY/)
    } finally {
      if (saved !== undefined) process.env.ENCRYPTION_KEY = saved
    }
    expect(() => encodeSetting('providers.storage', 'floppy', false)).toThrow(/unknown provider/)
    // Credentials never go in as plain settings.
    expect(() => encodeSetting('storage.secret_access_key', 'x', false)).toThrow(/--secret/)
    expect(encodeSetting('storage.secret_access_key', 'secret://s3/key', false).value).toBe('secret://s3/key')
    expect(() => encodeSetting('nonsense', 1, false)).toThrow(/Unknown instance setting/)
    expect(encodeSetting('instance.admin_emails', ['a@b.c'], false).key).toBe('instance.admin_emails')
  })

  it('diffs settings snapshots and masks connection strings', () => {
    const before = [{ key: 'providers.storage', value: 'supabase', secret: false }, { key: 'storage.bucket', value: 'a', secret: false }]
    const after = [{ key: 'providers.storage', value: 'local', secret: false }, { key: 'storage.local_root', value: '/d', secret: false }, { key: 'storage.bucket', value: 'a', secret: false }]
    expect(changedSettingKeys(before, after)).toEqual(['providers.storage', 'storage.local_root'])
    expect(maskUrl('postgresql://app:s3cret@db.example.com:5432/app')).toBe('postgresql://app:****@db.example.com:5432/app')
    expect(maskUrl('postgresql://db.example.com/app')).not.toMatch(/\*/)
  })

})

describe('usertasks-admin bootstrap and storage init', () => {
  it('parses bootstrap and storage init', () => {
    const { command, values } = parseCommand(['bootstrap', '--email', 'ops@acme.example', '--org', 'Acme', '--api-key', 'Provisioning', '--if-missing'], {})
    expect(command).toEqual({ kind: 'bootstrap' })
    expect(values).toMatchObject({ email: 'ops@acme.example', org: 'Acme', 'api-key': 'Provisioning', 'if-missing': true })
    expect(parseCommand(['storage', 'init'], {}).command).toEqual({ kind: 'storage-init' })
    expect(() => parseCommand(['storage'], {})).toThrow(UsageError)
    expect(() => parseCommand(['storage', 'wipe'], {})).toThrow(UsageError)
    expect(() => parseCommand(['bootstrap', 'extra'], {})).toThrow(UsageError)
  })

  it('validates bootstrap input before touching any provider', async () => {
    const ok = { email: 'ops@acme.example', password: 'long-enough', org: 'Acme' }
    expect(checkBootstrapInput(ok)).toBeNull()
    expect(checkBootstrapInput({ ...ok, apiKeyName: 'Provisioning' })).toBeNull()
    expect(checkBootstrapInput({ ...ok, email: 'not-an-email' })).toMatch(/invalid --email/)
    expect(checkBootstrapInput({ ...ok, password: 'short' })).toMatch(/at least 8/)
    expect(checkBootstrapInput({ ...ok, org: '' })).toMatch(/needs --email/)
    expect(checkBootstrapInput({ ...ok, apiKeyName: '  ' })).toMatch(/--api-key/)
    // Missing password: usage error (exit 2), nothing provisioned.
    const out = io({})
    expect(await run(['bootstrap', '--email', 'ops@acme.example', '--org', 'Acme'], out)).toBe(2)
    expect(out.errors.join('\n')).toMatch(/BOOTSTRAP_PASSWORD/)
  })
})
