import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCommand, providerEnvReady, run, UsageError } from '../src/cli'
import { runSetupCode } from '../src/setup-code'
import { loadLocalEnv, missingProviderEnv, parseEnvFile } from '../src/local-env'
import { setupFakeDb } from '../../../__tests__/helpers/setup-fake-db'
import { checkSetupCode, CODE_KEY, resetSetupStateForTests } from '@/lib/setup/state'

function io(env: Record<string, string | undefined> = {}) {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, env, out: (l: string) => lines.push(l), err: (l: string) => errors.push(l) }
}

const dirs: string[] = []
function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-env-'))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  resetSetupStateForTests()
})

describe('usertasks-admin setup-code', () => {
  it('parses setup-code and setup-code status', () => {
    expect(parseCommand(['setup-code'], {}).command).toEqual({ kind: 'setup-code', action: 'new' })
    expect(parseCommand(['setup-code', 'status'], {}).command).toEqual({ kind: 'setup-code', action: 'status' })
    expect(() => parseCommand(['setup-code', 'show'], {})).toThrow(UsageError)
  })

  it('prints a new code that the server accepts, and the old one stops working', async () => {
    const fake = setupFakeDb()
    const first = io()
    expect(await runSetupCode('new', first, fake.db)).toBe(0)
    const code1 = /setup code: (\S+)/.exec(first.lines[0])![1]
    expect(first.lines[0]).toBe(`UserTasks setup code: ${code1} (open /setup to create the admin account)`)
    expect(await checkSetupCode(fake.db, code1, {})).toBe(true)
    const second = io()
    expect(await runSetupCode('new', second, fake.db)).toBe(0)
    const code2 = /setup code: (\S+)/.exec(second.lines[0])![1]
    expect(await checkSetupCode(fake.db, code1, {})).toBe(false)
    expect(await checkSetupCode(fake.db, code2, {})).toBe(true)
    expect(fake.tables.instance_settings.filter((r) => r.key === CODE_KEY)).toHaveLength(1)
  })

  it('status says whether setup is needed', async () => {
    const fake = setupFakeDb()
    const out = io({ USERTASKS_SETUP_CODE: 'compose-code-1234' })
    expect(await runSetupCode('status', out, fake.db)).toBe(0)
    expect(out.lines.join('\n')).toMatch(/Setup is needed[\s\S]*USERTASKS_SETUP_CODE is set[\s\S]*No setup code yet/)
  })

  it('refuses once setup is complete, and in the cloud edition', async () => {
    const done = setupFakeDb({ tenants: [{ id: 't1' }] })
    const out = io()
    expect(await runSetupCode('new', out, done.db)).toBe(1)
    expect(out.errors[0]).toMatch(/Setup is complete/)
    expect(done.tables.instance_settings).toHaveLength(0)
    const status = io()
    expect(await runSetupCode('status', status, done.db)).toBe(0)
    expect(status.lines[0]).toMatch(/Setup is complete/)
    expect(await runSetupCode('new', io({ DEPLOYMENT_MODE: 'cloud' }), done.db)).toBe(2)
  })
})

describe('.env.local for bootstrap and setup-code', () => {
  it('parses KEY=value files', () => {
    expect(parseEnvFile([
      '# comment', 'export A=1', 'B = two # trailing', 'C="quoted # not a comment"', "D='single'", 'E="multi', 'line"', 'F=', 'not a line',
    ].join('\r\n'))).toEqual({ A: '1', B: 'two', C: 'quoted # not a comment', D: 'single', E: 'multi\nline', F: '' })
  })

  it('loads .env.local then .env without overriding what is set', () => {
    const dir = tmp({ '.env.local': 'NEXT_PUBLIC_SUPABASE_URL=http://local\nSUPABASE_SERVICE_ROLE_KEY=from-file\n', '.env': 'NEXT_PUBLIC_SUPABASE_URL=http://dotenv\nEXTRA=yes\n' })
    const env: Record<string, string | undefined> = { SUPABASE_SERVICE_ROLE_KEY: 'from-shell' }
    expect(loadLocalEnv(dir, env)).toEqual(['.env.local', '.env'])
    expect(env).toEqual({ SUPABASE_SERVICE_ROLE_KEY: 'from-shell', NEXT_PUBLIC_SUPABASE_URL: 'http://local', EXTRA: 'yes' })
    expect(loadLocalEnv(tmp({}), {})).toEqual([])
  })

  it('knows what each provider needs', () => {
    expect(missingProviderEnv({})).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
    expect(missingProviderEnv({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' })).toEqual([])
    expect(missingProviderEnv({ DB_PROVIDER: 'postgres', AUTH_PROVIDER: 'builtin' })).toEqual(['DATABASE_URL'])
    expect(missingProviderEnv({ DB_PROVIDER: 'postgres', AUTH_PROVIDER: 'builtin', DATABASE_URL: 'postgres://x' })).toEqual([])
  })

  it('explains the wrong folder, or what is missing', () => {
    const wrong = io()
    expect(providerEnvReady(wrong as never, tmp({}))).toBe(false)
    expect(wrong.errors[0]).toMatch(/Missing environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/)
    expect(wrong.errors[0]).toMatch(/Run this from the UserTasks folder \(the one with package.json\)/)

    const noEnvFile = io()
    expect(providerEnvReady(noEnvFile as never, tmp({ 'package.json': '{}' }))).toBe(false)
    expect(noEnvFile.errors[0]).toMatch(/No \.env\.local in/)

    const ok = io()
    expect(providerEnvReady(ok as never, tmp({ 'package.json': '{}', '.env.local': 'DB_PROVIDER=postgres\nAUTH_PROVIDER=builtin\nDATABASE_URL=postgres://u@h/db\n' }))).toBe(true)
    expect(ok.env.DATABASE_URL).toBe('postgres://u@h/db')
  })

  it('bootstrap still reports bad input before looking at the environment', async () => {
    const out = io({})
    expect(await run(['bootstrap', '--email', 'ops@acme.example', '--org', 'Acme'], out as never)).toBe(2)
    expect(out.errors.join('\n')).toMatch(/BOOTSTRAP_PASSWORD/)
  })
})
