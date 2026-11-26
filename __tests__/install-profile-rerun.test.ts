/**
 * `usertasks-admin install profile` re-runs of a separated install (the
 * Infrastructure add-on boundary, lib/install/standard-stack.ts):
 *
 *  - write / validate --merge: what a profile keeps in instance settings
 *    (the presets' files, sign-in, email, …) is not in the env file, so the
 *    running instance is asked before a re-run with the same answers is
 *    refused for a licence;
 *  - the running settings are read without decrypting secret rows (that
 *    would read ENCRYPTION_KEY before apply sets it from the merged env file);
 *  - apply --licence installs the licence for the profile's address when the
 *    installer's process has no APP_URL.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; value: unknown; secret: boolean }>,
  decoded: [] as string[][],
  licenceEnv: [] as Array<string | undefined>,
  connects: 0,
}))

vi.mock('@/packages/admin/src/instance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/admin/src/instance')>()
  return {
    ...actual,
    connect: async () => { state.connects++; return { end: async () => undefined, query: async () => ({ rows: [] }) } },
    readSettingRows: async () => state.rows,
    decodeSettings: (rows: Array<{ key: string; value: unknown; secret: boolean }>, warn?: (line: string) => void) => {
      state.decoded.push(rows.map((r) => r.key))
      return actual.decodeSettings(rows as never, warn)
    },
    applyProfileSettings: async () => ({ written: [], kept: [] }),
  }
})
vi.mock('@/packages/admin/src/licence-cli', () => ({
  sqlLicenceStore: () => ({}),
  runLicence: async (_action: string, _args: string[], _values: unknown, _store: unknown, io: { env: Record<string, string | undefined> }) => { state.licenceEnv.push(io.env.APP_URL); return 0 },
}))
vi.mock('@/lib/install/apply', () => ({ applyProfileSettings: async () => ({ written: [], kept: [] }) }))
vi.mock('@/lib/infrastructure/licence-gate', () => ({
  checkInfrastructureLicenceText: () => ({ ok: true, reason: null, decision: { allowed: true, state: 'licensed' }, licenceId: 'lic_test', customer: 'Test', expiresAt: null }),
}))

const { runInstallCommand } = await import('@/packages/admin/src/install-cli')

const APP = 'https://tasks.example.com'
const DB = 'postgresql://usertasks:pw@db.example.com:5432/usertasks?sslmode=require'
const PROFILE = [
  '--preset', 'existing', '--set', `app.url=${APP}`, '--set', `database.url=${DB}`,
  '--set', 'storage.endpoint=https://s3.example.com', '--set', 'storage.access_key_id=k', '--set', 'storage.secret_access_key=s',
  '--set', 'email.smtp_host=mail.example.com', '--set', 'email.from=t@example.com',
]

function mergeFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ut-rerun-'))
  const file = path.join(dir, '.env')
  // What `write` put in the env file on the first run: the database (environment), not the files (instance settings).
  writeFileSync(file, `DB_PROVIDER=postgres\nDATABASE_URL=${DB}\nMIGRATION_DATABASE_URL=${DB}\nENCRYPTION_KEY=${'a'.repeat(64)}\nAPP_URL=\n`)
  return file
}

async function run(args: string[], env: Record<string, string> = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = await runInstallCommand(['profile', ...args], { out: (l) => out.push(l), err: (l) => err.push(l), env: env as NodeJS.ProcessEnv })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('install profile re-runs of a separated install', () => {
  beforeEach(() => {
    state.rows = []
    state.decoded = []
    state.licenceEnv = []
    state.connects = 0
  })
  const originalKey = process.env.ENCRYPTION_KEY
  afterEach(() => {
    vi.unstubAllEnvs()
    // apply sets ENCRYPTION_KEY from the merged env file for its process.
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalKey
  })

  it('write --merge with the same answers: the files the instance already runs need no licence', async () => {
    state.rows = [
      { key: 'providers.storage', value: 's3', secret: false },
      { key: 'storage.endpoint', value: 'https://s3.example.com', secret: false },
      { key: 'storage.secret_access_key', value: 'enc:v1:aaaa:bbbb==:cccc==', secret: true },
    ]
    const file = mergeFile()
    const res = await run(['write', ...PROFILE, '--merge', file, '--out', path.join(path.dirname(file), 'out.env')])
    expect(res.code, res.err).toBe(0)
    expect(res.err).toMatch(/already configured here are kept/)
    // Secret rows are never decrypted for the comparison.
    expect(state.decoded.flat()).not.toContain('storage.secret_access_key')
  })

  it('write --merge with a new storage endpoint: still refused without a licence', async () => {
    state.rows = [{ key: 'providers.storage', value: 's3', secret: false }, { key: 'storage.endpoint', value: 'https://old-s3.example.com', secret: false }]
    const res = await run(['write', ...PROFILE, '--merge', mergeFile(), '--out', path.join(mkdtempSync(path.join(tmpdir(), 'ut-rerun-')), 'out.env')])
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/files \(an S3-compatible bucket at s3\.example\.com\).*Infrastructure add-on/)
  })

  it('a first write (no --merge) does not connect to anything', async () => {
    const res = await run(['validate', ...PROFILE], { DATABASE_URL: 'postgresql://x:y@db.example.com/z' })
    expect(res.code).toBe(1)
    expect(state.connects).toBe(0)
  })

  it('apply --licence installs the licence for the profile address when APP_URL is not set', async () => {
    const res = await run(['apply', ...PROFILE, '--merge', mergeFile(), '--db-url', 'postgresql://u:p@127.0.0.1:5432/usertasks', '--licence', path.join(__dirname, 'install-profile-rerun.test.ts')])
    expect(res.err).toMatch(/accepted for/)
    expect(state.licenceEnv).toEqual([APP])
    expect(process.env.ENCRYPTION_KEY).toBe('a'.repeat(64))
  })
})
