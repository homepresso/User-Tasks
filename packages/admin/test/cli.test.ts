import { describe, expect, it } from 'vitest'
import { parseCommand, run, UsageError, type CliIO } from '../src/cli'
import { checkBootstrapInput } from '../src/bootstrap'
import { plannedSettings } from '../src/switch/engine'
import { changedSettingKeys, encodeSetting, maskUrl } from '../src/instance'
import { matchTables } from '../src/switch/database'
import { pgRewriteDb } from '../src/switch/storage'
import { SWITCH_PLANS } from '../src/switch/plans'
import { resolveInstanceConfig } from '@/lib/config'
import { PROVIDER_AREAS } from '@/lib/config/schema'

function io(env: NodeJS.ProcessEnv = {}): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, env, out: (l) => lines.push(l), err: (l) => errors.push(l) }
}

describe('usertasks-admin argument parsing', () => {
  it('parses switch with area aliases, repeated options and flags', () => {
    const { command } = parseCommand([
      'switch', 'storage', '--to', 'S3', '--dry-run', '--set', 'endpoint=http://minio:9000', '--set', 'force_path_style=true',
      '--secret', 'secret_access_key=abc=def', '--bucket', 'logos', '--bucket', 'brand-fonts', '--backup-dir', '/tmp/b', '--actor', 'ops',
    ], {})
    expect(command.kind).toBe('switch')
    if (command.kind !== 'switch') return
    expect(command.area).toBe('storage')
    expect(command.options).toMatchObject({
      to: 's3', dryRun: true, yes: false, backupRoot: '/tmp/b', actor: 'ops',
      set: { endpoint: 'http://minio:9000', force_path_style: 'true' },
      secret: { secret_access_key: 'abc=def' },
    })
    expect(command.options.flags.bucket).toEqual(['logos', 'brand-fonts'])
    const db = parseCommand(['switch', 'database', '--to', 'postgres', '--target-url', 'postgres://x/y'], {}).command
    expect(db).toMatchObject({ kind: 'switch', area: 'db' })
  })

  it('rejects bad input with usage errors', () => {
    const bad = [
      ['switch'],
      ['switch', 'files', '--to', 'local'],
      ['switch', 'storage'],
      ['switch', 'database', '--to', 'postgres'],
      ['switch', 'storage', '--to', 'local', '--set', 'novalue'],
      ['switch', 'storage', '--to', 'local', '--set', 'Bad-Key=1'],
      ['doctor', '--area', 'files'],
      ['rollback'],
      ['history', '--limit', 'ten'],
      ['instance-admins', 'add', 'not-an-email'],
      ['frobnicate'],
      ['status', '--unknown-flag'],
    ]
    for (const argv of bad) expect(() => parseCommand(argv, {}), argv.join(' ')).toThrow(UsageError)
  })

  it('uses BACKUP_DIR when --backup-dir is absent', () => {
    const { command } = parseCommand(['switch', 'email', '--to', 'smtp'], { BACKUP_DIR: '/srv/backups' })
    expect(command.kind === 'switch' && command.options.backupRoot).toBe('/srv/backups')
  })

  it('run(): help, usage errors (exit 2) and commands that need a database', async () => {
    const help = io()
    expect(await run(['--help'], help)).toBe(0)
    expect(help.lines.join('\n')).toMatch(/usertasks-admin switch <area> --to <provider>/)

    const usage = io()
    expect(await run(['switch', 'storage'], usage)).toBe(2)
    expect(usage.errors[0]).toMatch(/--to/)

    for (const argv of [['switch', 'email', '--to', 'smtp', '--yes'], ['rollback', '00000000-0000-0000-0000-000000000000'], ['history']]) {
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

describe('switch planning helpers', () => {
  it('plans the provider setting, or an env change when the provider is env-managed', () => {
    const saved = process.env.STORAGE_PROVIDER
    delete process.env.STORAGE_PROVIDER
    const config = resolveInstanceConfig(new Map())
    if (saved !== undefined) process.env.STORAGE_PROVIDER = saved
    const options = { to: 'local', set: { local_root: '/data' }, secret: {} } as never
    const planned = plannedSettings({ area: 'storage', to: 'local', options, config }, SWITCH_PLANS.storage)
    expect(planned.rows.map((r) => [r.key, r.value])).toEqual([['providers.storage', 'local'], ['storage.local_root', '/data']])
    expect(planned.env).toEqual({})

    const envConfig = { ...config, providers: { ...config.providers, storage: { ...config.providers.storage, source: 'env' as const } } }
    const envPlanned = plannedSettings({ area: 'storage', to: 'local', options, config: envConfig }, SWITCH_PLANS.storage)
    expect(envPlanned.env).toEqual({ STORAGE_PROVIDER: 'local' })
    expect(envPlanned.rows.map((r) => r.key)).toEqual(['storage.local_root'])

    // The database is bootstrap config: never an instance setting.
    const dbPlanned = plannedSettings({ area: 'db', to: 'postgres', options: { to: 'postgres', set: {}, secret: {} } as never, config }, SWITCH_PLANS.db)
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

  it('every area has a switch plan; the database only switches to postgres', () => {
    for (const area of PROVIDER_AREAS) expect(SWITCH_PLANS[area].area).toBe(area)
    expect(SWITCH_PLANS.db.supports('supabase', 'postgres')).toBeNull()
    expect(SWITCH_PLANS.db.supports('postgres', 'supabase')).toMatch(/Supabase/)
  })

  it('matches tables and columns present on both sides', () => {
    const { tables, onlySource } = matchTables(
      [{ schema: 'public', name: 'a', columns: ['id', 'x', 'gone'] }, { schema: 'public', name: 'b', columns: ['id'] }],
      [{ schema: 'public', name: 'a', columns: ['id', 'x', 'new'] }],
    )
    expect(tables).toEqual([{ schema: 'public', name: 'a', columns: ['id', 'x'] }])
    expect(onlySource).toEqual(['public.b'])
  })

  it('pgRewriteDb compiles the select / update calls rewriteStorageUrls makes', async () => {
    const calls: Array<[string, unknown[] | undefined]> = []
    const db = pgRewriteDb({ query: async (text: string, values?: unknown[]) => { calls.push([text, values]); return { rows: [{ id: '1', branding: {} }] } } } as never)
    const read = await db.from('tenants').select('id, branding').order('id', { ascending: true }).range(0, 499)
    expect(read).toEqual({ data: [{ id: '1', branding: {} }], error: null })
    await db.from('tenants').update({ branding: { logo_url: 'storage://logos/a.png' } }).eq('id', '1')
    expect(calls[0][0]).toBe('SELECT "id", "branding" FROM public."tenants" ORDER BY "id" ASC LIMIT 500 OFFSET 0')
    expect(calls[1]).toEqual(['UPDATE public."tenants" SET "branding" = $1 WHERE "id" = $2', [JSON.stringify({ logo_url: 'storage://logos/a.png' }), '1']])
    const failing = pgRewriteDb({ query: async () => { throw new Error('relation "x" does not exist') } } as never)
    expect((await failing.from('x').select('id, c').order('id').range(0, 1)).error).toEqual({ message: 'relation "x" does not exist' })
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
