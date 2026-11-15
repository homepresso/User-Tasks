import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run, type CliIO } from '../src/cli'
import { parseEnvFile } from '@/lib/install/profile'

function io(env: NodeJS.ProcessEnv = {}): CliIO & { lines: string[]; errors: string[]; text: () => string } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, env, out: (l) => lines.push(l), err: (l) => errors.push(l), text: () => lines.join('\n') }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'ut-install-cli-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const KEY = 'f'.repeat(64)

describe('usertasks-admin install', () => {
  it('help and usage errors', async () => {
    const help = io()
    expect(await run(['install', '--help'], help)).toBe(0)
    expect(help.text()).toMatch(/install profile validate\|check\|write\|apply/)
    const bad = io()
    expect(await run(['install', 'profile', 'frobnicate'], bad)).toBe(2)
    expect(bad.errors[0]).toMatch(/Unknown command/)
    expect(await run(['install', 'profile', 'validate', '--preset', 'cloud9'], io())).toBe(2)
    expect(await run(['install', 'profile', 'validate', '--set', 'nonsense'], io())).toBe(2)
    expect(await run(['install', 'profile', 'write', '--format', 'yaml', '--preset', 'server'], io())).toBe(2)
  })

  it('presets lists the four presets (json for installers)', async () => {
    const out = io()
    expect(await run(['install', 'presets', '--format', 'json'], out)).toBe(0)
    const list = JSON.parse(out.text()) as Array<{ id: string; label: string }>
    expect(list.map((p) => p.id)).toEqual(['supabase', 'server', 'existing', 'windows'])
    expect(list[1].label).toBe('Everything on this server (no Supabase)')
  })

  it('validate: exit 1 with the problems, exit 0 with a summary', async () => {
    const bad = io()
    expect(await run(['install', 'profile', 'validate', '--preset', 'existing', '--set', 'app.url=https://t.example.com'], bad)).toBe(1)
    expect(bad.errors.join('\n')).toMatch(/database\.url/)
    const badJson = io()
    expect(await run(['install', 'profile', 'validate', '--preset', 'existing', '--set', 'app.url=https://t.example.com', '--format', 'json'], badJson)).toBe(1)
    expect(JSON.parse(badJson.text()).ok).toBe(false)

    const good = io({ SMTP_PW: 'hunter2' })
    const args = ['install', 'profile', 'validate', '--preset', 'server', '--set', 'app.url=https://t.example.com', '--provider', 'email=smtp',
      '--set', 'email.smtp_host=mail.example.com', '--set', 'email.smtp_password=@env:SMTP_PW', '--set', 'email.from=tasks@example.com', '--format', 'json']
    expect(await run(args, good)).toBe(0)
    const result = JSON.parse(good.text())
    expect(result.ok).toBe(true)
    expect(good.text()).not.toContain('hunter2')
    expect(result.settings.find((s: { key: string }) => s.key === 'email.smtp_password')).toMatchObject({ secret: true, value: '********' })
    expect(await run(['install', 'profile', 'validate', '--set', 'email.smtp_password=@env:NOPE', '--preset', 'server'], io())).toBe(2)
  })

  it('write env: generates secrets once, keeps them on re-run, file is private', async () => {
    const out = path.join(dir, 'usertasks.env')
    const base = ['install', 'profile', 'write', '--preset', 'server', '--set', 'app.url=http://localhost:3490', '--set', 'placement=env', '--out', out]
    expect(await run([...base, '--generate-secrets'], io())).toBe(0)
    const first = parseEnvFile(readFileSync(out, 'utf8'))
    expect(first.ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/)
    expect(first.USERTASKS_SETUP_CODE).toMatch(/^[A-Z2-9]{4}-/)
    expect(first.STORAGE_PROVIDER).toBe('local')
    if (process.platform !== 'win32') expect(statSync(out).mode & 0o777).toBe(0o600)
    // Re-run (an upgrade): existing secrets win even with --generate-secrets.
    expect(await run([...base, '--generate-secrets', '--set', 'email.from=x@example.com'], io())).toBe(0)
    const second = parseEnvFile(readFileSync(out, 'utf8'))
    expect(second.ENCRYPTION_KEY).toBe(first.ENCRYPTION_KEY)
    expect(second.CRON_SECRET).toBe(first.CRON_SECRET)
    expect(second.EMAIL_FROM).toBe('x@example.com')
    // --force with a different key is refused.
    const refused = io()
    expect(await run([...base, '--force', '--set', `app.encryptionKey=${KEY}`], refused)).toBe(2)
    expect(refused.errors[0]).toMatch(/different ENCRYPTION_KEY/)
  })

  it('write json from a profile file and stdin-free flags; settings carry credentials for apply', async () => {
    const file = path.join(dir, 'profile.json')
    writeFileSync(file, JSON.stringify({
      preset: 'server',
      app: { url: 'https://tasks.example.com', encryptionKey: KEY, adminEmails: ['ops@example.com'] },
      email: { provider: 'smtp', smtpPreset: 'm365', options: { smtp_user: 'tasks@example.com', smtp_password: 'pw', from: 'tasks@example.com' } },
    }))
    const out = io()
    expect(await run(['install', 'profile', 'write', '--from', file, '--format', 'json'], out)).toBe(0)
    const parsed = JSON.parse(out.text())
    expect(parsed.env.ENCRYPTION_KEY).toBe(KEY)
    expect(parsed.env.EMAIL_PROVIDER).toBeUndefined()
    expect(parsed.settings).toContainEqual({ key: 'email.smtp_host', value: 'smtp.office365.com', secret: false })
    expect(parsed.settings).toContainEqual({ key: 'email.smtp_password', value: 'pw', secret: true })
    expect(parsed.generated).toEqual([])
  })

  it('check: runs the checks offline-safe areas and reports failures', async () => {
    const out = io()
    const code = await run(['install', 'profile', 'check', '--preset', 'server', '--set', 'app.url=http://localhost:3000',
      '--set', `files.local_root=${path.join(dir, 'files')}`, '--area', 'storage,email,scheduler,realtime', '--format', 'json'], out)
    const report = JSON.parse(out.text())
    expect(code).toBe(0)
    expect(report.areas).toMatchObject({ storage: 'ok', email: 'ok', scheduler: 'ok', realtime: 'ok' })
    const db = io()
    expect(await run(['install', 'profile', 'check', '--preset', 'server', '--set', 'app.url=http://localhost:3000', '--set', 'database.port=1', '--area', 'database'], db)).toBe(1)
    expect(db.text()).toMatch(/FAIL.*can't connect/)
  })

  it('apply needs a database', async () => {
    const out = io({})
    expect(await run(['install', 'profile', 'apply', '--preset', 'server', '--set', 'app.url=http://localhost:3000', '--set', 'database.url=postgres://u@127.0.0.1:1/x', '--set', `app.encryptionKey=${KEY}`], out)).toBe(1)
    const envOnly = io()
    expect(await run(['install', 'profile', 'apply', '--preset', 'server', '--set', 'app.url=http://localhost:3000', '--set', 'placement=env'], envOnly)).toBe(0)
    expect(envOnly.text()).toMatch(/Nothing to apply/)
  })
})
