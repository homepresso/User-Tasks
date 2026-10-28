/**
 * storage:// references, URL resolution per provider, and the validators
 * that used to hard-code Supabase public URLs (theme images / fonts,
 * workspace logo).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PublicConfig } from '@/lib/config/public'
import { buildPublicConfig } from '@/lib/config/public'
import {
  formatStorageRef, isOwnStorageObject, parseOwnStorageUrl, parseStorageRef, resolveStorageUrl,
  storageObjectUrl, tenantFolderObject, toStorageRef,
} from '@/lib/storage/refs'
import { persistableStorageValue, fileRefFields } from '@/lib/storage/persist'
import { bucketLocation, publicBaseFor, storageConfigSync } from '@/lib/providers/storage/options'
import { WorkspaceThemeSchema, isOwnStorageUrl } from '@/lib/theme/schema'
import { isWorkspaceLogoUrl } from '@/lib/services/tenant-settings'
import { defaultWorkspaceTheme } from '@/lib/theme/presets'
import { themeStylesheet } from '@/lib/theme/to-css'
import { writeSettingsCache } from '@/lib/config/settings-cache'

const SB = 'https://proj.supabase.co'
const APP = 'https://tasks.example.com'
const supabaseCfg: PublicConfig = { supabaseUrl: SB, supabaseAnonKey: 'anon', appUrl: APP, ssoMicrosoft: false }
const localCfg: PublicConfig = { ...supabaseCfg, storage: { provider: 'local' } }
const s3Cfg: PublicConfig = { ...supabaseCfg, storage: { provider: 's3', publicBases: { logos: 'https://cdn.example.com/acme-logos' } } }

const env = { ...process.env }
const STORAGE_ENV = ['STORAGE_PROVIDER', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'SUPABASE_URL', 'STORAGE_PUBLIC_BASE_URL', 'STORAGE_BUCKET_PREFIX', 'STORAGE_BUCKET', 'STORAGE_BUCKET_MAP']
beforeEach(() => {
  for (const name of STORAGE_ENV) delete process.env[name]
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
})
afterEach(() => {
  process.env = { ...env }
  writeSettingsCache(null)
})

describe('storage references', () => {
  it('format / parse round-trip with encoded segments and a query', () => {
    const ref = formatStorageRef('task-files', 'data-tables/t1/My File #1.pdf', '?t=5')
    expect(ref).toBe('storage://task-files/data-tables/t1/My%20File%20%231.pdf?t=5')
    expect(parseStorageRef(ref)).toEqual({ bucket: 'task-files', key: 'data-tables/t1/My File #1.pdf', search: '?t=5' })
  })

  it('rejects unknown buckets, traversal and malformed refs', () => {
    for (const bad of ['storage://other/x', 'storage://logos/../x', 'storage://logos/a//b', 'storage://logos', 'storage://logos/%2e%2e/x', 'storage://logos/a%5Cb', 'https://x/y']) {
      expect(parseStorageRef(bad), bad).toBeNull()
    }
  })

  it('recognises every own form, and nothing foreign', () => {
    expect(parseOwnStorageUrl(`${SB}/storage/v1/object/public/logos/t/l.png?t=1`, supabaseCfg)).toMatchObject({ bucket: 'logos', key: 't/l.png', search: '?t=1', form: 'supabase' })
    expect(parseOwnStorageUrl('/files/logos/t/l.png', supabaseCfg)).toMatchObject({ bucket: 'logos', key: 't/l.png', form: 'files' })
    expect(parseOwnStorageUrl(`${APP}/files/logos/t/l.png`, supabaseCfg)).toMatchObject({ form: 'files' })
    expect(parseOwnStorageUrl('https://cdn.example.com/acme-logos/t/l.png', s3Cfg)).toMatchObject({ bucket: 'logos', key: 't/l.png', form: 'public_base' })
    expect(parseOwnStorageUrl('storage://logos/t/l.png', supabaseCfg)).toMatchObject({ form: 'ref' })
    for (const foreign of [
      'https://evil.example/storage/v1/object/public/logos/t/l.png',
      'https://evil.example/files/logos/t/l.png',
      `${SB}/storage/v1/object/public/secret-bucket/t/l.png`,
      `${SB}/storage/v1/object/public/logos/t/l.png") ; x`,
      'javascript:alert(1)',
      `https://user:pw@proj.supabase.co/storage/v1/object/public/logos/t/l.png`,
    ]) expect(parseOwnStorageUrl(foreign, supabaseCfg), foreign).toBeNull()
  })

  it('toStorageRef normalises own values and leaves others alone', () => {
    expect(toStorageRef(`${SB}/storage/v1/object/public/logos/t/l.png?t=1`, supabaseCfg)).toBe('storage://logos/t/l.png?t=1')
    expect(toStorageRef('https://example.com/x.png', supabaseCfg)).toBe('https://example.com/x.png')
    expect(toStorageRef(42 as unknown, supabaseCfg)).toBe(42)
  })
})

describe('resolveStorageUrl', () => {
  const ref = 'storage://logos/tenant-a/logo.png?t=9'

  it('supabase (default): the Supabase public URL', () => {
    expect(resolveStorageUrl(ref, { config: supabaseCfg })).toBe(`${SB}/storage/v1/object/public/logos/tenant-a/logo.png?t=9`)
  })

  it('local / s3 without a public base: the /files route (absolute on APP_URL when asked)', () => {
    expect(resolveStorageUrl(ref, { config: localCfg })).toBe('/files/logos/tenant-a/logo.png?t=9')
    expect(resolveStorageUrl(ref, { config: localCfg, absolute: true })).toBe(`${APP}/files/logos/tenant-a/logo.png?t=9`)
  })

  it('s3 with a public base: the direct URL', () => {
    expect(resolveStorageUrl(ref, { config: s3Cfg })).toBe('https://cdn.example.com/acme-logos/tenant-a/logo.png?t=9')
    expect(resolveStorageUrl('storage://brand-fonts/t/a.woff2', { config: s3Cfg })).toBe('/files/brand-fonts/t/a.woff2')
  })

  it('legacy Supabase URLs: unchanged under supabase, served by the app under other providers', () => {
    const legacy = `${SB}/storage/v1/object/public/logos/tenant-a/logo.png?t=1`
    expect(resolveStorageUrl(legacy, { config: supabaseCfg })).toBe(legacy)
    expect(resolveStorageUrl(legacy, { config: localCfg })).toBe('/files/logos/tenant-a/logo.png?t=1')
    expect(resolveStorageUrl('https://other.example/a.png', { config: localCfg })).toBe('https://other.example/a.png')
  })

  it('null / empty pass through', () => {
    expect(resolveStorageUrl(null)).toBeNull()
    expect(resolveStorageUrl(undefined)).toBeNull()
    expect(resolveStorageUrl('')).toBe('')
  })

  it('object URLs encode key segments', () => {
    expect(storageObjectUrl('task-files', 'a b/c"d.txt', { config: localCfg })).toBe('/files/task-files/a%20b/c%22d.txt')
  })
})

describe('runtime config', () => {
  it('the public config gains `storage` only for non-default providers', () => {
    delete process.env.STORAGE_PROVIDER
    expect(buildPublicConfig().storage).toBeUndefined()
    process.env.STORAGE_PROVIDER = 'local'
    expect(buildPublicConfig().storage).toEqual({ provider: 'local' })
    process.env.STORAGE_PROVIDER = 's3'
    process.env.STORAGE_PUBLIC_BASE_URL = 'https://{bucket}.s3.eu-west-1.amazonaws.com'
    process.env.STORAGE_BUCKET_PREFIX = 'acme-'
    expect(buildPublicConfig().storage).toEqual({
      provider: 's3',
      publicBases: {
        'task-files': 'https://acme-task-files.s3.eu-west-1.amazonaws.com',
        logos: 'https://acme-logos.s3.eu-west-1.amazonaws.com',
        'brand-fonts': 'https://acme-brand-fonts.s3.eu-west-1.amazonaws.com',
      },
    })
    // Never secrets.
    process.env.S3_SECRET_ACCESS_KEY = 'shh'
    expect(JSON.stringify(buildPublicConfig())).not.toContain('shh')
  })

  it('the provider can come from instance settings (last loaded values)', () => {
    delete process.env.STORAGE_PROVIDER
    writeSettingsCache(new Map<string, unknown>([['providers.storage', 'gcs'], ['storage.bucket', 'one-bucket']]))
    expect(storageConfigSync()).toMatchObject({ id: 'gcs', options: { bucket: 'one-bucket' } })
  })

  it('storage credentials can only be stored as encrypted instance settings', async () => {
    const { setInstanceSetting } = await import('@/lib/config/instance-settings')
    for (const key of ['storage.secret_access_key', 'storage.azure_connection_string', 'storage.azure_account_key', 'storage.azure_sas_token', 'storage.gcs_credentials_json']) {
      await expect(setInstanceSetting(key, 'x'), key).rejects.toThrow(/credential: store it as a secret/)
    }
    // Secret but no ENCRYPTION_KEY: refused too (never stored in clear text).
    delete process.env.ENCRYPTION_KEY
    await expect(setInstanceSetting('storage.secret_access_key', 'x', { secret: true })).rejects.toThrow(/ENCRYPTION_KEY/)
  })

  it('bucket mapping: map, single bucket with prefixes, name prefix', () => {
    expect(bucketLocation('logos', { bucket_map: '{"logos":"brand/assets/logos"}' })).toEqual({ container: 'brand', keyPrefix: 'assets/logos/' })
    expect(bucketLocation('task-files', { bucket_map: '{"logos":"x"}', bucket_prefix: 'p-' })).toEqual({ container: 'p-task-files', keyPrefix: '' })
    expect(bucketLocation('logos', { bucket: 'everything' })).toEqual({ container: 'everything', keyPrefix: 'logos/' })
    expect(publicBaseFor('logos', { bucket: 'everything', public_base_url: 'https://cdn.example.com' })).toBe('https://cdn.example.com/everything/logos')
    expect(() => bucketLocation('logos', { bucket_map: 'not json' })).toThrow(/JSON/)
    expect(() => bucketLocation('logos', { bucket_prefix: '../' })).toThrow(/Invalid bucket/)
  })
})

describe('persisting', () => {
  const legacy = `${SB}/storage/v1/object/public/logos/tenant-a/logo.png?t=1`

  it('supabase keeps writing public URLs exactly as before', () => {
    process.env.SUPABASE_URL = SB
    expect(persistableStorageValue(legacy, 'supabase')).toBe(legacy)
    expect(persistableStorageValue('storage://logos/tenant-a/logo.png?t=1', 'supabase')).toBe(legacy)
    expect(fileRefFields('task-files', 'a/b', 'supabase')).toEqual({})
    expect(fileRefFields('task-files', 'a/b', undefined)).toEqual({})
  })

  it('other providers write storage:// references', () => {
    process.env.SUPABASE_URL = SB
    process.env.STORAGE_PROVIDER = 'local'
    expect(persistableStorageValue(legacy, 'local')).toBe('storage://logos/tenant-a/logo.png?t=1')
    expect(persistableStorageValue('/files/logos/tenant-a/logo.png', 's3')).toBe('storage://logos/tenant-a/logo.png')
    expect(persistableStorageValue('https://elsewhere.example/x.png', 'local')).toBe('https://elsewhere.example/x.png')
    expect(fileRefFields('task-files', 'a/b', 'gcs')).toEqual({ ref: 'storage://task-files/a/b' })
  })
})

describe('validators accept references and /files URLs (and legacy URLs)', () => {
  it('theme images and fonts', () => {
    process.env.SUPABASE_URL = SB
    expect(isOwnStorageUrl('storage://logos/tenant-a/logo.png', ['logos'])).toBe(true)
    expect(isOwnStorageUrl('/files/brand-fonts/tenant-a/a.woff2', ['brand-fonts'])).toBe(true)
    expect(isOwnStorageUrl(`${SB}/storage/v1/object/public/logos/tenant-a/logo.png`, ['logos'])).toBe(true)
    expect(isOwnStorageUrl('storage://task-files/tenant-a/logo.png', ['logos'])).toBe(false)
    const theme = defaultWorkspaceTheme()
    theme.branding.logoLight = 'storage://logos/tenant-a/logo.png?t=2'
    theme.typography.sans = { source: 'upload', family: 'Brand Sans', url: 'storage://brand-fonts/tenant-a/brand.woff2' }
    expect(WorkspaceThemeSchema.safeParse(theme).success).toBe(true)
    theme.typography.sans = { source: 'upload', family: 'Brand Sans', url: 'storage://brand-fonts/tenant-a/brand.ttf' }
    expect(WorkspaceThemeSchema.safeParse(theme).success).toBe(false)
  })

  it('workspace logo: only this tenant’s folder in logos', () => {
    process.env.SUPABASE_URL = SB
    expect(isWorkspaceLogoUrl('storage://logos/tenant-a/logo.png?t=1', 'tenant-a')).toBe(true)
    expect(isWorkspaceLogoUrl(`${APP}/files/logos/tenant-a/logo.png`, 'tenant-a')).toBe(false) // APP_URL not configured
    process.env.APP_URL = APP
    expect(isWorkspaceLogoUrl(`${APP}/files/logos/tenant-a/logo.png`, 'tenant-a')).toBe(true)
    expect(isWorkspaceLogoUrl('/files/logos/tenant-b/logo.png', 'tenant-a')).toBe(false)
    expect(isWorkspaceLogoUrl('storage://logos/tenant-a', 'tenant-a')).toBe(false)
    expect(tenantFolderObject('storage://brand-fonts/tenant-a/x.woff2', 'brand-fonts', 'tenant-a')).toBe('x.woff2')
    expect(isOwnStorageObject('storage://logos/a/b', ['logos'])).toBe(true)
  })

  it('theme CSS resolves uploaded font references per provider', () => {
    process.env.SUPABASE_URL = SB
    const theme = defaultWorkspaceTheme()
    theme.typography.display = { source: 'upload', family: 'Brand Serif', url: 'storage://brand-fonts/t/b.woff2' }
    expect(themeStylesheet(theme)).toContain(`src:url("${SB}/storage/v1/object/public/brand-fonts/t/b.woff2") format("woff2")`)
    process.env.STORAGE_PROVIDER = 'local'
    expect(themeStylesheet(theme)).toContain(`src:url("/files/brand-fonts/t/b.woff2") format("woff2")`)
  })
})

describe('content security policy', () => {
  it('is unchanged by default and adds loopback http stores for direct public URLs', async () => {
    const { buildContentSecurityPolicy, contentSecurityPolicy } = await import('@/lib/csp')
    const base = buildContentSecurityPolicy({ supabaseUrl: SB, isDev: false })
    expect(buildContentSecurityPolicy({ supabaseUrl: SB, isDev: false, storagePublicBases: undefined })).toBe(base)
    const minio = buildContentSecurityPolicy({ supabaseUrl: SB, isDev: false, storagePublicBases: { logos: 'http://127.0.0.1:9010/logos', x: 'http://minio.internal/x' } })
    expect(minio).toContain("img-src 'self' blob: data: https: http://127.0.0.1:9010")
    expect(minio).toContain("font-src 'self' data: https: http://127.0.0.1:9010")
    expect(minio).not.toContain('minio.internal')
    // A local `supabase start` stack serves public files over loopback http.
    expect(buildContentSecurityPolicy({ supabaseUrl: 'http://127.0.0.1:54321', isDev: true })).toContain("img-src 'self' blob: data: https: http://127.0.0.1:54321;")
    process.env.STORAGE_PROVIDER = 's3'
    process.env.STORAGE_PUBLIC_BASE_URL = 'http://localhost:9010'
    expect(contentSecurityPolicy()).toContain('img-src \'self\' blob: data: https: http://localhost:9010')
  })
})
