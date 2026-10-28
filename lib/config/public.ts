import { getBootstrapConfig, getEnvProviderOverrides, readEnv } from './bootstrap'
import { readSettingsCache } from './settings-cache'
import { DEFAULT_PROVIDERS, providerIdSchema, type ProviderId } from './schema'
import { publicBasesFor, storageConfigSync } from '@/lib/providers/storage/options'

/**
 * Public (browser-safe) runtime config.
 *
 * Replaces the build-time NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / _SSO_MICROSOFT
 * / _APP_URL reads in client code. The server builds it from the bootstrap
 * config; the root layout serialises it into `window.__USERTASKS_CONFIG__`
 * before hydration (and GET /api/config/public serves the same object), so a
 * single build works against any Supabase project.
 *
 * Only values that are already public belong here: the anon key is designed
 * to ship to browsers. Never add the service-role key, ENCRYPTION_KEY,
 * processor secrets or DATABASE_URL — __tests__/runtime-config.test.ts
 * asserts that.
 */
export interface PublicConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  appUrl: string
  ssoMicrosoft: boolean
  /**
   * Realtime provider the browser uses (lib/providers/realtime). Present only
   * when it isn't the default (supabase), so default installs serve exactly
   * the object they always did.
   */
  realtimeProvider?: ProviderId<'realtime'>
  /**
   * Where stored files are served from (lib/storage/refs.ts resolves
   * `storage://` references with it). Present only when the storage provider
   * isn't the default (supabase), like realtimeProvider. `publicBases` maps a
   * bucket to a direct public URL base (S3 / CDN); other buckets are served
   * by the app at /files/<bucket>/<key>.
   */
  storage?: { provider: Exclude<ProviderId<'storage'>, 'supabase'>; publicBases?: Record<string, string> }
}

export const PUBLIC_CONFIG_GLOBAL = '__USERTASKS_CONFIG__'
export const PUBLIC_CONFIG_PATH = '/api/config/public'

declare global {
  interface Window {
    __USERTASKS_CONFIG__?: PublicConfig
  }
}

/**
 * Realtime provider id: REALTIME_PROVIDER, else the `providers.realtime`
 * instance setting when the settings cache is warm (GET /api/config/public
 * warms it first), else the default.
 */
function publicRealtimeProvider(): ProviderId<'realtime'> {
  let fromEnv: ProviderId<'realtime'> | undefined
  try {
    fromEnv = getEnvProviderOverrides().realtime
  } catch {
    fromEnv = undefined
  }
  if (fromEnv) return fromEnv
  const stored = providerIdSchema('realtime').safeParse(readSettingsCache()?.get('providers.realtime'))
  return stored.success ? stored.data : DEFAULT_PROVIDERS.realtime
}

/** Storage provider and public bases, when not the default. */
function publicStorage(): PublicConfig['storage'] {
  const { id, options } = storageConfigSync()
  if (id === 'supabase') return undefined
  const publicBases = id === 'local' ? undefined : publicBasesFor(options)
  return { provider: id, ...(publicBases ? { publicBases } : {}) }
}

/** Server: the public config for this instance. */
export function buildPublicConfig(): PublicConfig {
  const cfg = getBootstrapConfig()
  const realtimeProvider = publicRealtimeProvider()
  const storage = publicStorage()
  return {
    supabaseUrl: cfg.supabase.url ?? '',
    supabaseAnonKey: cfg.supabase.anonKey ?? '',
    appUrl: cfg.appUrl ?? '',
    ssoMicrosoft: cfg.ssoMicrosoft,
    ...(realtimeProvider !== DEFAULT_PROVIDERS.realtime ? { realtimeProvider } : {}),
    ...(storage ? { storage } : {}),
  }
}

/** Build-time values, the fallback when no runtime config reached the page. */
function inlinedPublicConfig(): PublicConfig {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
    ssoMicrosoft: process.env.NEXT_PUBLIC_SSO_MICROSOFT === '1',
  }
}

/**
 * Public config on either side. In the browser: the runtime object the root
 * layout injected, else the build-time values (so a build that still has
 * NEXT_PUBLIC_* set — Vercel — behaves exactly as before).
 */
export function getPublicConfig(): PublicConfig {
  if (typeof window === 'undefined') return buildPublicConfig()
  const injected = window.__USERTASKS_CONFIG__
  if (injected?.supabaseUrl) return injected
  const inlined = inlinedPublicConfig()
  if (!injected) return inlined
  // A runtime without Supabase (postgres db, sse realtime, built-in auth)
  // injects no Supabase URL: its provider choices still win.
  return { ...injected, supabaseUrl: inlined.supabaseUrl, supabaseAnonKey: inlined.supabaseAnonKey, appUrl: injected.appUrl || inlined.appUrl }
}

/**
 * `<script>` body that installs the config; safe to inline in HTML.
 *
 * `refresh` is for pages prerendered at build time: the inlined values are the
 * build environment's, so the script also fetches the runtime config in the
 * background and swaps it in (the browser data client follows the current
 * values, see lib/supabase/client.ts). Pages rendered per request inline the
 * runtime values and skip the fetch.
 */
export function publicConfigScript(config: PublicConfig, options: { refresh?: boolean } = {}): string {
  const json = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  const install = `window.${PUBLIC_CONFIG_GLOBAL}=${json};`
  if (!options.refresh) return install
  return `${install}try{fetch('${PUBLIC_CONFIG_PATH}',{credentials:'omit'}).then(function(r){return r.ok?r.json():null}).then(function(c){if(c&&typeof c==='object')window.${PUBLIC_CONFIG_GLOBAL}=c}).catch(function(){})}catch(e){}`
}

/** True while `next build` prerenders static pages (values are the build's, not the server's). */
export function isBuildPrerender(): boolean {
  return readEnv('NEXT_PHASE') === 'phase-production-build'
}
