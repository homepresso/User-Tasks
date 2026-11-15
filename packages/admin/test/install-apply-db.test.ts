/**
 * `usertasks-admin install profile apply` against a real, plain PostgreSQL
 * scratch database with the repository migrations applied: settings written
 * (credentials encrypted), existing settings kept unless --overwrite,
 * instance admins merged, and the app's config resolving the result.
 *
 * Runs only with MIGRATION_TEST_ADMIN_URL (a role that may CREATE DATABASE on
 * a NON-Supabase server), like infra-ui-db.test.ts.
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMigrations } from '../src/db/migrations'
import { migrate } from '../src/db/runner'
import { run, type CliIO } from '../src/cli'
import { decodeSettings, readSettingRows, upsertSettingRow } from '../src/instance'
import { resolveInstanceConfig } from '@/lib/config'

const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL
const REPO_MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')
const KEY = 'c'.repeat(64)

function io(env: NodeJS.ProcessEnv): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, env, out: (l) => lines.push(l), err: (l) => errors.push(l) }
}

describe.skipIf(!ADMIN_URL)('install profile apply (plain PostgreSQL)', { timeout: 60_000 }, () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  const envBackup = { ...process.env }
  let name: string
  let url: string
  let db: pg.Client

  beforeAll(async () => {
    await admin.connect()
    name = `ut_install_${randomUUID().slice(0, 8)}`
    await admin.query(`CREATE DATABASE ${name}`)
    const u = new URL(ADMIN_URL!)
    u.pathname = `/${name}`
    url = u.toString()
    db = new pg.Client({ connectionString: url })
    await db.connect()
    await migrate(db, loadMigrations(REPO_MIGRATIONS))
    for (const key of Object.keys(process.env)) if (/_PROVIDER$|^SMTP_|^EMAIL_|^STORAGE_|^ENCRYPTION_KEY$|^INSTANCE_ADMIN_EMAILS$/.test(key)) delete process.env[key]
  }, 180_000)
  afterAll(async () => {
    process.env = envBackup
    await db.end().catch(() => undefined)
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined)
    await admin.end()
  })

  const profileArgs = (extra: string[] = []) => [
    'install', 'profile', 'apply', '--preset', 'server', '--db-url', url,
    '--set', 'app.url=http://localhost:3490', '--set', `app.encryptionKey=${KEY}`, '--set', 'app.adminEmails=ops@example.com',
    '--provider', 'email=smtp', '--set', 'email.smtp_host=127.0.0.1', '--set', 'email.smtp_port=55491', '--set', 'email.smtp_starttls=off',
    '--set', 'email.smtp_password=@env:SMTP_PW', '--set', 'email.from=UserTasks <noreply@example.com>', ...extra,
  ]

  it('writes provider settings with credentials encrypted; the app config resolves them', async () => {
    const out = io({ SMTP_PW: 'smtp-secret-for-tests' })
    expect(await run(profileArgs(), out)).toBe(0)
    expect(out.lines.join('\n')).toMatch(/set providers\.email/)
    const rows = await readSettingRows(db)
    const pw = rows.find((r) => r.key === 'email.smtp_password')!
    expect(pw.secret).toBe(true)
    expect(JSON.stringify(pw.value)).not.toContain('smtp-secret-for-tests')
    process.env.ENCRYPTION_KEY = KEY
    const config = resolveInstanceConfig(decodeSettings(rows))
    expect(config.providers.email).toMatchObject({ id: 'smtp', source: 'settings', options: { smtp_host: '127.0.0.1', smtp_password: 'smtp-secret-for-tests' } })
    expect(config.providers.storage).toMatchObject({ id: 'local', options: { local_root: '/var/lib/usertasks/files' } })
    expect(config.providers.scheduler.id).toBe('worker')
    delete process.env.ENCRYPTION_KEY
  })

  it('a re-run keeps settings changed since (wizard), merges admins; --overwrite replaces', async () => {
    await upsertSettingRow(db, { key: 'email.smtp_host', value: 'mail.changed-in-wizard.example', secret: false })
    await upsertSettingRow(db, { key: 'instance.admin_emails', value: 'owner@example.com', secret: false })
    const again = io({ SMTP_PW: 'x-secret' })
    expect(await run(profileArgs(), again)).toBe(0)
    expect(again.lines.join('\n')).toMatch(/kept email\.smtp_host/)
    let settings = decodeSettings(await readSettingRows(db))
    expect(settings.get('email.smtp_host')).toBe('mail.changed-in-wizard.example')
    expect(String(settings.get('instance.admin_emails')).split(',').sort()).toEqual(['ops@example.com', 'owner@example.com'])
    expect(await run(profileArgs(['--overwrite']), io({ SMTP_PW: 'x-secret' }))).toBe(0)
    settings = decodeSettings(await readSettingRows(db))
    expect(settings.get('email.smtp_host')).toBe('127.0.0.1')
  })

  it('check: database reachable, version, schema present', async () => {
    const out = io({})
    const u = new URL(url)
    const code = await run(['install', 'profile', 'check', '--preset', 'server', '--set', 'app.url=http://localhost:3490', '--set', `database.url=${url}`, '--area', 'database,scheduler', '--format', 'json'], out)
    const report = JSON.parse(out.lines.join('\n'))
    expect(code).toBe(0)
    expect(report.checks.find((c: { name: string }) => c.name === 'schema')).toMatchObject({ status: 'ok' })
    expect(report.checks.find((c: { name: string }) => c.name === 'connection').detail).toContain(u.pathname.slice(1))
  })

  it('apply before migrations is refused with what to do', async () => {
    const empty = `ut_install_empty_${randomUUID().slice(0, 8)}`
    await admin.query(`CREATE DATABASE ${empty}`)
    try {
      const u = new URL(ADMIN_URL!)
      u.pathname = `/${empty}`
      const out = io({ SMTP_PW: 'x' })
      expect(await run([...profileArgs(), '--db-url', u.toString()], out)).toBe(1)
      expect(out.errors.join('\n')).toMatch(/db migrate/)
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${empty} WITH (FORCE)`)
    }
  })
})
