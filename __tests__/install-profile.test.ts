import { describe, expect, it } from 'vitest'
import {
  fillSecrets, flagsLayer, formatEnvFile, mergeProfileLayers, parseEnvFile, postgresUrl, PRESET_IDS, presetProfile, profileToConfig,
  redactEnv, redactProfile, validateProfile, ProfileInputError, SETTINGS_AREAS, type Profile,
} from '@/lib/install/profile'
import { OPTION_ENV } from '@/lib/config/provider-forms'
import { PROVIDER_ENV } from '@/lib/config/schema'
import { profileInstanceConfig } from '@/lib/install/checks'

const KEY = 'a'.repeat(64)
const APP = { url: 'https://tasks.example.com', encryptionKey: KEY }

function valid(input: unknown): Profile {
  const result = validateProfile(input)
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.profile
}

function errors(input: unknown): string[] {
  const result = validateProfile(input)
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`)
}

const server = (extra: Record<string, unknown> = {}) => mergeProfileLayers(presetProfile('server'), { app: APP }, extra)

describe('install profile: presets', () => {
  it('server preset is valid with only the app URL', () => {
    const p = valid(mergeProfileLayers(presetProfile('server'), { app: { url: 'http://localhost:3000' } }))
    expect(p.database).toMatchObject({ provider: 'postgres', hosting: 'bundled' })
    expect(p.auth.provider).toBe('builtin')
    expect(p.storage).toEqual({ provider: 'local', options: { local_root: '/var/lib/usertasks/files' } })
    expect(p.scheduler.provider).toBe('worker')
    expect(p.realtime.provider).toBe('sse')
    expect(p.placement).toBe('settings')
  })

  it('supabase preset asks for the project and the Resend key', () => {
    const errs = errors(mergeProfileLayers(presetProfile('supabase'), { app: APP }))
    expect(errs.some((e) => e.startsWith('supabase:'))).toBe(true)
    expect(errs.some((e) => e.startsWith('email.options.resend_api_key'))).toBe(true)
    const ok = valid(mergeProfileLayers(presetProfile('supabase'), { app: APP, supabase: { url: 'https://abc.supabase.co/', anonKey: 'anon', serviceRoleKey: 'service' }, email: { options: { resend_api_key: 're_123' } } }))
    expect(ok.supabase?.url).toBe('https://abc.supabase.co')
  })

  it('existing preset asks for database, S3 and SMTP details', () => {
    const errs = errors(mergeProfileLayers(presetProfile('existing'), { app: APP }))
    expect(errs.join('\n')).toMatch(/database\.url/)
    expect(errs.join('\n')).toMatch(/email\.options\.from/)
    const ok = valid(mergeProfileLayers(presetProfile('existing'), {
      app: APP,
      database: { url: 'postgres://ut:pw@db.internal:5432/usertasks' },
      storage: { options: { endpoint: 'https://s3.internal', access_key_id: 'k', secret_access_key: 's', bucket: 'usertasks' } },
      email: { options: { smtp_host: 'mail.internal', from: 'UserTasks <noreply@example.com>' } },
    }))
    expect(postgresUrl(ok.database as never)).toBe('postgres://ut:pw@db.internal:5432/usertasks?sslmode=require')
  })

  it('windows preset: Microsoft 365 SMTP defaults and an Entra ID identity provider', () => {
    const p = valid(mergeProfileLayers(presetProfile('windows'), {
      app: APP,
      auth: { sso: [{ id: 'entra', type: 'oidc', preset: 'entra', tenantId: 'contoso.onmicrosoft.com', clientId: 'cid', clientSecret: 'secret://entra' }] },
      email: { options: { smtp_user: 'tasks@contoso.com', smtp_password: 'pw', from: 'tasks@contoso.com' } },
    }))
    expect(p.email.options).toMatchObject({ smtp_host: 'smtp.office365.com', smtp_port: '587', smtp_starttls: 'required' })
    expect(p.storage.options.local_root).toBe('C:\\ProgramData\\UserTasks\\files')
    expect(errors(mergeProfileLayers(presetProfile('windows'), { app: APP, email: { options: { from: 'a@b.co' } } })).join('\n')).toMatch(/smtp_user/)
  })

  it('every preset has an id, label and starting profile', () => {
    for (const id of PRESET_IDS) expect(presetProfile(id).preset).toBe(id)
  })
})

describe('install profile: validation', () => {
  it('rejects unknown providers, sections and options', () => {
    expect(errors(server({ email: { provider: 'pigeon' } })).join()).toMatch(/email\.provider/)
    expect(errors({ ...server(), extra: 1 }).join()).toMatch(/Unrecognized key/)
    expect(errors(server({ storage: { options: { local_root: '/x', bucket: 'b' } } })).join()).toMatch(/storage\.options\.bucket: not an option of the local provider/)
  })

  it('checks option values with the provider form schemas', () => {
    expect(errors(server({ email: { provider: 'smtp', options: { smtp_host: 'h', smtp_port: 'abc', from: 'a@b.co' } } })).join()).toMatch(/Port must be a number/)
    expect(errors(server({ email: { provider: 'smtp', options: { smtp_host: 'h', smtp_starttls: 'maybe', from: 'a@b.co' } } })).join()).toMatch(/STARTTLS must be one of/)
    expect(errors(server({ email: { provider: 'smtp', options: { from: 'a@b.co' } } })).join()).toMatch(/SMTP host is required/)
    expect(errors(server({ email: { provider: 'smtp', options: { smtp_host: 'h', from: 'not an address' } } })).join()).toMatch(/From address must be an email/)
    expect(errors({ ...server(), storage: { provider: 'local', options: {} } }).join()).toMatch(/Root directory is required/)
  })

  it('accepts secret:// references for credentials', () => {
    const p = valid(server({ email: { provider: 'smtp', options: { smtp_host: 'h', smtp_password: 'secret://smtp-password', from: 'a@b.co' } } }))
    expect(p.email.options.smtp_password).toBe('secret://smtp-password')
    expect(errors(server({ email: { provider: 'smtp', options: { smtp_host: 'h', smtp_password: 'secret://', from: 'a@b.co' } } })).join()).toMatch(/invalid secret reference/)
  })

  it('needs a Supabase project only when something is on Supabase', () => {
    expect(errors(server({ storage: { provider: 'supabase', options: {} } })).join()).toMatch(/needed by: files/)
    const r = validateProfile(server({ supabase: { url: 'https://x.supabase.co', anonKey: 'a', serviceRoleKey: 's' } }))
    expect(r.ok && r.warnings.some((w) => w.path === 'supabase')).toBe(true)
  })

  it('refuses combinations that cannot work', () => {
    expect(errors(server({ auth: { provider: 'supabase' } })).join()).toMatch(/Supabase sign-in needs the Supabase database/)
    expect(errors(server({ realtime: { provider: 'supabase' } })).join()).toMatch(/realtime\.provider/)
    expect(errors(server({ auth: { provider: 'oidc' } })).join()).toMatch(/at least one OIDC identity provider/)
  })

  it('database: connection, hosting, token auth and TLS rules', () => {
    expect(errors(server({ database: { provider: 'postgres', hosting: 'own', host: undefined, database: undefined, user: undefined } })).join()).toMatch(/database\.url/)
    expect(errors(server({ database: { provider: 'postgres', url: 'mysql://x' } })).join()).toMatch(/postgres:\/\//)
    expect(errors(server({ database: { provider: 'postgres', hosting: 'rds', url: 'postgres://u@x/db', auth: 'azure' } })).join()).toMatch(/does not work with rds/)
    expect(errors(server({ database: { provider: 'postgres', hosting: 'own', url: 'postgres://u@x/db', auth: 'aws' } })).join()).toMatch(/managed databases only/)
    expect(errors(server({ database: { provider: 'postgres', hosting: 'azure', url: 'postgres://u@x/db', auth: 'azure', sslmode: 'disable' } })).join()).toMatch(/need TLS/)
    const rds = valid(server({ database: { provider: 'postgres', hosting: 'rds', host: 'db.abc.us-east-1.rds.amazonaws.com', database: 'ut', user: 'ut_iam', auth: 'aws', sslmode: 'require' } }))
    expect(profileToConfig(rds).env).toMatchObject({ DATABASE_AUTH: 'aws', DATABASE_URL: 'postgresql://ut_iam@db.abc.us-east-1.rds.amazonaws.com:5432/ut?sslmode=require' })
  })

  it('identity providers: preset requirements and duplicate ids', () => {
    expect(errors(server({ auth: { sso: [{ id: 'entra', type: 'oidc', preset: 'entra', clientId: 'c' }] } })).join()).toMatch(/tenant/)
    expect(errors(server({ auth: { sso: [{ id: 'kc', type: 'oidc', preset: 'keycloak', clientId: 'c' }] } })).join()).toMatch(/Keycloak needs baseUrl/)
    expect(errors(server({ auth: { sso: [{ id: 'g', type: 'oidc', clientId: 'c' }] } })).join()).toMatch(/needs issuer/)
    expect(errors(server({ auth: { sso: [{ id: 'adfs', type: 'saml', preset: 'adfs' }] } })).join()).toMatch(/SAML needs the IdP metadata/)
    const dup = { id: 'kc', type: 'oidc', preset: 'keycloak', baseUrl: 'https://kc.example.com', realm: 'r', clientId: 'c' }
    expect(errors(server({ auth: { sso: [dup, dup] } })).join()).toMatch(/duplicate/)
    expect(errors(server({ auth: { options: { sso_providers: '[]' } } })).join()).toMatch(/use auth\.sso/)
  })

  it('LDAP: built-in sign-in only; plain ldap warns', () => {
    const ldap = { url: 'ldap://dc1.corp.local', bindDn: 'CN=svc,DC=corp,DC=local', baseDn: 'DC=corp,DC=local' }
    const r = validateProfile(server({ auth: { ldap } }))
    expect(r.ok && r.warnings.some((w) => w.path === 'auth.ldap.url')).toBe(true)
    expect(errors(server({ auth: { ldap: { ...ldap, url: 'http://x' } } })).join()).toMatch(/ldaps?:\/\//)
  })

  it('app: URL, admin emails, encryption key format', () => {
    expect(errors(server({ app: { url: 'ftp://x' } })).join()).toMatch(/app\.url/)
    expect(errors(server({ app: { url: 'https://x.example.com', encryptionKey: 'short' } })).join()).toMatch(/32 bytes/)
    expect(valid(server({ app: { url: 'https://x.example.com/', encryptionKey: 'secret://encryption_key' } })).app.url).toBe('https://x.example.com')
    expect(errors(server({ app: { url: 'https://x.example.com', adminEmails: ['nope'] } })).join()).toMatch(/adminEmails/)
  })

  it('never throws on garbage', () => {
    for (const input of [null, 1, 'x', [], {}, { app: null }]) expect(validateProfile(input).ok).toBe(false)
  })
})

describe('install profile: mapping to configuration', () => {
  it('placement env: every provider and option as environment variables', () => {
    const p = valid(server({ placement: 'env', email: { provider: 'smtp', smtpPreset: 'mailpit', options: { smtp_host: 'mailpit', from: 'UserTasks <noreply@example.com>' } } }))
    const { env, settings, secretKeys } = profileToConfig(p)
    expect(settings).toEqual([])
    expect(env).toMatchObject({
      DEPLOYMENT_MODE: 'self_hosted', APP_URL: APP.url, NEXT_PUBLIC_APP_URL: APP.url, ENCRYPTION_KEY: KEY,
      DB_PROVIDER: 'postgres', DATABASE_URL: 'postgresql://usertasks@localhost:5432/usertasks?sslmode=disable',
      AUTH_PROVIDER: 'builtin', STORAGE_PROVIDER: 'local', STORAGE_LOCAL_ROOT: '/var/lib/usertasks/files',
      EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_STARTTLS: 'off', EMAIL_FROM: 'UserTasks <noreply@example.com>',
      SCHEDULER_PROVIDER: 'worker', SCHEDULER_IN_PROCESS: 'true', REALTIME_PROVIDER: 'sse', CACHE_PROVIDER: 'postgres', SECRETS_PROVIDER: 'env', KMS_PROVIDER: 'env',
    })
    expect(env.MIGRATION_DATABASE_URL).toBe(env.DATABASE_URL)
    expect(env.REALTIME_DATABASE_URL).toBe(env.DATABASE_URL)
    expect(secretKeys).toContain('ENCRYPTION_KEY')
    expect(secretKeys).toContain('DATABASE_URL')
  })

  it('placement settings: changeable areas become instance settings, credentials flagged secret', () => {
    const p = valid(server({
      app: { url: APP.url, encryptionKey: KEY, adminEmails: ['Ops@Example.com'] },
      email: { provider: 'smtp', options: { smtp_host: 'mail', smtp_password: 'pw', from: 'a@b.co' } },
      auth: { sso: [{ id: 'kc', type: 'oidc', preset: 'keycloak', baseUrl: 'https://kc.example.com', realm: 'r', clientId: 'c', clientSecret: 'cs' }] },
    }))
    const { env, settings, notes, secretKeys } = profileToConfig(p)
    for (const area of SETTINGS_AREAS) expect(env[PROVIDER_ENV[area === 'storage' ? 'storage' : area as never]]).toBeUndefined()
    expect(env.DB_PROVIDER).toBe('postgres')
    expect(env.REALTIME_PROVIDER).toBe('sse')
    const byKey = Object.fromEntries(settings.map((s) => [s.key, s]))
    expect(byKey['providers.email']).toEqual({ key: 'providers.email', value: 'smtp', secret: false })
    expect(byKey['email.smtp_password']).toEqual({ key: 'email.smtp_password', value: 'pw', secret: true })
    expect(byKey['email.smtp_host'].secret).toBe(false)
    expect(byKey['auth.sso_providers'].secret).toBe(true)
    expect(JSON.parse(byKey['auth.sso_providers'].value)[0]).toMatchObject({ id: 'kc', clientSecret: 'cs' })
    expect(byKey['instance.admin_emails'].value).toBe('ops@example.com')
    expect(secretKeys).toContain('email.smtp_password')
    expect(notes.join('\n')).toMatch(/install profile apply/)
    expect(notes.join('\n')).toMatch(/https:\/\/tasks\.example\.com\/auth\/sso\/kc\/callback/)
  })

  it('secret:// references are stored as plain (non-secret) settings', () => {
    const p = valid(server({ email: { provider: 'smtp', options: { smtp_host: 'mail', smtp_password: 'secret://smtp', from: 'a@b.co' } } }))
    expect(profileToConfig(p).settings.find((s) => s.key === 'email.smtp_password')).toMatchObject({ secret: false, value: 'secret://smtp' })
  })

  it('every option env var the mapping emits is a real provider option variable', () => {
    const p = valid(server({ placement: 'env', email: { provider: 'smtp', options: { smtp_host: 'm', from: 'a@b.co', smtp_user: 'u', smtp_password: 'p' } } }))
    const known = new Set([...Object.values(OPTION_ENV).flatMap((m) => Object.values(m ?? {})), ...Object.values(PROVIDER_ENV)])
    const bootstrap = ['DEPLOYMENT_MODE', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'ENCRYPTION_KEY', 'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'REALTIME_DATABASE_URL']
    for (const name of Object.keys(profileToConfig(p).env)) if (!bootstrap.includes(name)) expect(known.has(name), name).toBe(true)
  })

  it('Supabase profile: project variables, optional direct connection', () => {
    const p = valid(mergeProfileLayers(presetProfile('supabase'), { placement: 'env', app: APP, database: { url: 'postgres://postgres.x:pw@pooler:5432/postgres' }, supabase: { url: 'https://x.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc' }, email: { options: { resend_api_key: 're_1' } } }))
    const { env } = profileToConfig(p)
    expect(env).toMatchObject({ DB_PROVIDER: 'supabase', SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 're_1', DATABASE_URL: 'postgres://postgres.x:pw@pooler:5432/postgres' })
  })

  it('session URL for poolers; CA file and passwords encoded', () => {
    const p = valid(server({ database: { provider: 'postgres', hosting: 'own', host: 'db', database: 'ut', user: 'ut', password: 'p@ss w/rd', sslmode: 'verify-full', caFile: '/etc/ssl/ca.pem', sessionUrl: 'postgres://ut@db:5433/ut' } }))
    const { env } = profileToConfig(p)
    expect(env.DATABASE_URL).toBe('postgresql://ut:p%40ss%20w%2Frd@db:5432/ut?sslmode=verify-full')
    expect(env.MIGRATION_DATABASE_URL).toBe('postgres://ut@db:5433/ut')
    expect(env.DATABASE_SSL_CA_FILE).toBe('/etc/ssl/ca.pem')
  })

  it('profileInstanceConfig gives lib/config the same providers and options', () => {
    const p = valid(server({ email: { provider: 'console', options: { console_dir: '/tmp/mail' } } }))
    const config = profileInstanceConfig(p)
    expect(config.providers.email).toMatchObject({ id: 'console', options: { console_dir: '/tmp/mail' } })
    expect(config.providers.db.id).toBe('postgres')
    expect(config.bootstrap.appUrl).toBe(APP.url)
  })
})

describe('install profile: layers and flags', () => {
  it('flags: sections, short option form, aliases, providers, JSON', () => {
    const layer = flagsLayer({
      'app.url': 'https://x.example.com', 'files.local_root': '/srv/files', 'email.options.smtp_host': 'mail', 'email.from': 'a@b.co',
      'database.port': '5433', 'auth.sso': '[{"id":"g","type":"oidc","issuer":"https://id.example.com","clientId":"c"}]', 'app.adminEmails': 'a@b.co, c@d.co', placement: 'env',
    }, { email: 'smtp', files: 'local' })
    expect(layer).toMatchObject({
      placement: 'env', app: { url: 'https://x.example.com', adminEmails: ['a@b.co', 'c@d.co'] },
      storage: { provider: 'local', options: { local_root: '/srv/files' } },
      email: { provider: 'smtp', options: { smtp_host: 'mail', from: 'a@b.co' } },
      database: { port: 5433 }, auth: { sso: [{ id: 'g' }] },
    })
    expect(() => flagsLayer({ 'nope.x': '1' })).toThrow(ProfileInputError)
    expect(() => flagsLayer({ url: 'x' })).toThrow(/section/)
    expect(() => flagsLayer({ 'database.nope': '1' })).toThrow(/unknown field/)
    expect(() => flagsLayer({ 'auth.sso': '{' })).toThrow(/JSON/)
    expect(() => flagsLayer({}, { mail: 'smtp' })).toThrow(/unknown area/)
  })

  it('merge: later layers win, a provider change drops the old options', () => {
    const merged = mergeProfileLayers(
      { email: { provider: 'smtp', options: { smtp_host: 'a', from: 'x@y.co' } }, app: { url: 'u' } },
      { email: { options: { smtp_host: 'b' } } },
      { app: { port: 8080 } },
    )
    expect(merged).toEqual({ email: { provider: 'smtp', options: { smtp_host: 'b', from: 'x@y.co' } }, app: { url: 'u', port: 8080 } })
    expect(mergeProfileLayers({ storage: { provider: 'local', options: { local_root: '/x' } } }, { storage: { provider: 's3', options: { bucket: 'b' } } }))
      .toEqual({ storage: { provider: 's3', options: { bucket: 'b' } } })
  })
})

describe('install profile: secrets and output', () => {
  it('generates missing secrets, never replaces existing ones', () => {
    const p = valid(mergeProfileLayers(presetProfile('server'), { app: { url: APP.url } }))
    const first = fillSecrets(p)
    expect(first.generated).toEqual(['ENCRYPTION_KEY', 'CRON_SECRET', 'WORKFLOW_SIGNING_SECRET', 'USERTASKS_SETUP_CODE'])
    expect(first.profile.app.encryptionKey).toMatch(/^[0-9a-f]{64}$/)
    expect(first.profile.app.setupCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const again = fillSecrets({ ...p, app: { ...p.app, encryptionKey: 'b'.repeat(64) } }, { ENCRYPTION_KEY: KEY, CRON_SECRET: 'c'.repeat(32) })
    expect(again.profile.app.encryptionKey).toBe(KEY)
    expect(again.kept).toEqual(['ENCRYPTION_KEY'])
    expect(again.generated).not.toContain('ENCRYPTION_KEY')
    expect(fillSecrets(p, {}, { generate: false }).generated).toEqual([])
  })

  it('env file round trip, including awkward values', () => {
    const env = { A: 'plain', B: 'UserTasks <noreply@example.com>', C: 'has "quotes" and $dollar', D: 'back\\slash', E: '', F: "it's\nmulti" }
    expect(parseEnvFile(formatEnvFile(env, 'header'))).toEqual(env)
    expect(parseEnvFile('# c\nexport X=1\nY = two # comment\nZ=\'a b\'')).toEqual({ X: '1', Y: 'two', Z: 'a b' })
  })

  it('redaction hides every credential', () => {
    const p = valid(server({
      app: { url: APP.url, encryptionKey: KEY, cronSecret: 'c'.repeat(32), setupCode: 'ABCD-EFGH-JKLM' },
      database: { provider: 'postgres', url: 'postgres://ut:hunter2@db/ut' },
      email: { provider: 'smtp', options: { smtp_host: 'mail', smtp_password: 'hunter3', from: 'a@b.co' } },
      auth: { sso: [{ id: 'kc', type: 'oidc', preset: 'keycloak', baseUrl: 'https://kc.example.com', realm: 'r', clientId: 'c', clientSecret: 'hunter4' }], ldap: { url: 'ldaps://dc', bindDn: 'cn=x', baseDn: 'dc=x', bindPassword: 'hunter5' } },
    }))
    const text = JSON.stringify(redactProfile(p)) + JSON.stringify(redactEnv(profileToConfig({ ...p, placement: 'env' })))
    for (const secret of [KEY, 'c'.repeat(32), 'ABCD-EFGH-JKLM', 'hunter2', 'hunter3', 'hunter4', 'hunter5']) expect(text).not.toContain(secret)
    expect(text).toContain('mail')
  })
})
