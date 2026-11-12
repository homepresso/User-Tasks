/**
 * npm run setup:local writes .env.local (scripts/setup-local/env-file.ts).
 * Pure functions only: no real .env.local is read or written here.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseEnvFile } from '@/packages/admin/src/local-env'
import {
  describePlan,
  generateCronSecret,
  generateEncryptionKey,
  isLocalUrl,
  isValidEncryptionKey,
  parseSupabaseStatus,
  planEnvFile,
  supabaseKeysFromStatus,
} from '@/scripts/setup-local/env-file'

const template = readFileSync('.env.example', 'utf8')
const supabase = { url: 'http://127.0.0.1:54321', anonKey: 'anon-jwt', serviceRoleKey: 'service-jwt', dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }

describe('setup:local .env.local', () => {
  it('creates the file from .env.example with the Supabase keys and fresh secrets', () => {
    const plan = planEnvFile({ template, existing: null, supabase })
    const env = parseEnvFile(plan.text)
    expect(plan.created).toBe(true)
    expect(plan.changed).toBe(true)
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(supabase.url)
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-jwt')
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-jwt')
    expect(env.DEPLOYMENT_MODE).toBe('self_hosted')
    expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000')
    // Formats: ENCRYPTION_KEY 32 bytes base64 (lib/secret-crypto.ts), CRON_SECRET 32 bytes hex.
    expect(env.ENCRYPTION_KEY).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(Buffer.from(env.ENCRYPTION_KEY, 'base64')).toHaveLength(32)
    expect(isValidEncryptionKey(env.ENCRYPTION_KEY)).toBe(true)
    expect(env.CRON_SECRET).toMatch(/^[0-9a-f]{64}$/)
    expect(plan.generated).toEqual(['ENCRYPTION_KEY', 'CRON_SECRET'])
    // The comments from .env.example are kept, and each variable appears once.
    expect(plan.text).toContain('# UserTasks environment variables.')
    expect(plan.text.match(/^ENCRYPTION_KEY=/gm)).toHaveLength(1)
    expect(plan.text.match(/^NEXT_PUBLIC_SUPABASE_URL=/gm)).toHaveLength(1)
    expect(plan.values.CRON_SECRET).toBe(env.CRON_SECRET)
  })

  it('takes the running stack URL even when it differs from the .env.example default', () => {
    const plan = planEnvFile({ template, existing: null, supabase: { ...supabase, url: 'http://127.0.0.1:55321' } })
    expect(parseEnvFile(plan.text).NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:55321')
    expect(plan.warnings).toEqual([])
  })

  it('generates new secrets every time', () => {
    expect(generateEncryptionKey()).not.toBe(generateEncryptionKey())
    expect(generateCronSecret()).not.toBe(generateCronSecret())
    const fixed = (n: number) => Buffer.alloc(n, 1)
    expect(generateCronSecret(fixed)).toBe('01'.repeat(32))
    expect(generateEncryptionKey(fixed)).toBe(Buffer.alloc(32, 1).toString('base64'))
  })

  it('never overwrites values already in .env.local; fills only the empty ones', () => {
    const existing = [
      'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=my-anon',
      'SUPABASE_SERVICE_ROLE_KEY=',
      'ENCRYPTION_KEY=' + 'ab'.repeat(32),
      'CRON_SECRET=keep-me',
      'RESEND_API_KEY=re_123',
      '',
    ].join('\n')
    const plan = planEnvFile({ template, existing, supabase })
    const env = parseEnvFile(plan.text)
    expect(plan.created).toBe(false)
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('my-anon')
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-jwt')
    expect(env.ENCRYPTION_KEY).toBe('ab'.repeat(32))
    expect(env.CRON_SECRET).toBe('keep-me')
    expect(env.RESEND_API_KEY).toBe('re_123')
    // Missing variables are appended, not invented elsewhere.
    expect(env.DEPLOYMENT_MODE).toBe('self_hosted')
    expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000')
    expect(plan.text.startsWith(existing.trimEnd())).toBe(false) // the empty service-role line was filled in place
    expect(plan.text).toContain('Added by npm run setup:local')
    expect(plan.filled).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_APP_URL', 'DEPLOYMENT_MODE'])
    expect(plan.generated).toEqual([])
    expect(plan.warnings.join('\n')).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local doesn't match")
  })

  it('leaves a complete file alone and is safe to run twice', () => {
    const first = planEnvFile({ template, existing: null, supabase })
    const second = planEnvFile({ template, existing: first.text, supabase })
    expect(second.changed).toBe(false)
    expect(second.text).toBe(first.text)
    expect(second.filled).toEqual([])
    expect(second.generated).toEqual([])
    expect(describePlan(second)[0]).toContain('left it as it was')
  })

  it('keeps a .env.local that points at another Supabase, unless --force; secrets survive --force', () => {
    const existing = 'NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=prod-anon\nSUPABASE_SERVICE_ROLE_KEY=prod-service\nENCRYPTION_KEY=prod-key\nCRON_SECRET=prod-cron\nDEPLOYMENT_MODE=cloud\n'
    const kept = planEnvFile({ template, existing, supabase })
    expect(parseEnvFile(kept.text).NEXT_PUBLIC_SUPABASE_URL).toBe('https://abc.supabase.co')
    expect(kept.warnings.join('\n')).toContain('points at another Supabase (abc.supabase.co)')
    expect(parseEnvFile(kept.text).DEPLOYMENT_MODE).toBe('cloud')

    const forced = planEnvFile({ template, existing, supabase, force: true })
    const env = parseEnvFile(forced.text)
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(supabase.url)
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-jwt')
    expect(forced.replaced).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
    expect(env.ENCRYPTION_KEY).toBe('prod-key')
    expect(env.CRON_SECRET).toBe('prod-cron')
    expect(forced.warnings.join('\n')).toContain('ENCRYPTION_KEY in .env.local is not 32 bytes')
  })

  it('tolerates Windows line endings and keeps them', () => {
    const crlfTemplate = template.replace(/\r?\n/g, '\r\n')
    const created = planEnvFile({ template: crlfTemplate, existing: null, supabase })
    expect(created.text).toContain('\r\n')
    expect(created.text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(parseEnvFile(created.text).NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-jwt')

    const existing = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\r\nSUPABASE_SERVICE_ROLE_KEY=\r\nCRON_SECRET=abc\r\n'
    const plan = planEnvFile({ template, existing, supabase })
    const env = parseEnvFile(plan.text)
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-jwt')
    expect(env.CRON_SECRET).toBe('abc')
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321')
    expect(plan.text.replace(/\r\n/g, '')).not.toContain('\n')
    // Running again on its own output changes nothing.
    expect(planEnvFile({ template, existing: plan.text, supabase }).changed).toBe(false)
  })

  it('warns when runtime-only overrides point elsewhere', () => {
    const plan = planEnvFile({ template, existing: 'SUPABASE_URL=https://abc.supabase.co\n', supabase })
    expect(plan.warnings.join('\n')).toContain('SUPABASE_URL is set in .env.local and takes precedence')
  })

  it('reports variable names only, never values', () => {
    const plan = planEnvFile({ template, existing: null, supabase })
    const report = [...describePlan(plan), ...plan.warnings].join('\n')
    expect(report).toContain('ENCRYPTION_KEY')
    for (const key of ['ENCRYPTION_KEY', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
      expect(report).not.toContain(plan.values[key])
    }
  })
})

describe('setup:local supabase status', () => {
  it('reads the keys `supabase status -o env` prints (CLI 2.x and 3.x names, quoted, CRLF)', () => {
    const output = 'ANON_KEY="eyJanon"\r\nAPI_URL="http://127.0.0.1:54321"\r\nDB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\r\nSERVICE_ROLE_KEY="eyJservice"\r\nSTUDIO_URL="http://127.0.0.1:54323"\r\n'
    expect(supabaseKeysFromStatus(parseSupabaseStatus(output))).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'eyJanon',
      serviceRoleKey: 'eyJservice',
      dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })
    expect(supabaseKeysFromStatus(parseSupabaseStatus('PUBLISHABLE_KEY="sb_publishable_x"\nSECRET_KEY="sb_secret_y"\nAPI_URL="http://127.0.0.1:54321"\n'))).toMatchObject({ anonKey: 'sb_publishable_x', serviceRoleKey: 'sb_secret_y' })
    expect(supabaseKeysFromStatus(parseSupabaseStatus(''))).toBeNull()
  })

  it('only treats this machine as local', () => {
    expect(isLocalUrl('http://127.0.0.1:54321')).toBe(true)
    expect(isLocalUrl('http://localhost:54321/')).toBe(true)
    expect(isLocalUrl('https://abc.supabase.co')).toBe(false)
    expect(isLocalUrl(undefined)).toBe(false)
  })

  it('is wired up as npm run setup:local, and config.toml works with Supabase CLI 3', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
    expect(scripts['setup:local']).toBe('tsx scripts/setup-local.ts')
    const config = readFileSync('supabase/config.toml', 'utf8')
    expect(config).toMatch(/^\[local_smtp\]$/m)
    expect(config).not.toMatch(/^\[inbucket\]$/m)
  })
})
