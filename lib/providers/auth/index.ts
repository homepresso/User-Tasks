import { getEnvProviderOverrides } from '@/lib/config/bootstrap'
import { loadInstanceSettings } from '@/lib/config/instance-settings'
import { DEFAULT_PROVIDERS, providerIdSchema, type ProviderId } from '@/lib/config/schema'
import { pickProvider } from '../registry'
import { createBuiltinAuthProvider } from './builtin'
import { supabaseAuthProvider } from './supabase'
import type { AuthProvider } from './types'

/**
 * AuthProvider (server only): who the current request's user is, and every
 * sign-in / sign-out / reset / SSO flow (contract in ./types).
 *
 *  - supabase (default): Supabase Auth through @supabase/ssr, server side.
 *  - builtin:            accounts + sessions in Postgres (app_auth), passwords
 *                        and configured OIDC / SAML IdPs.
 *  - oidc / saml:        built-in sessions, SSO only.
 *
 * Selected by AUTH_PROVIDER or the `providers.auth` instance setting. The
 * browser learns the sign-in options from the login page (names and buttons
 * only).
 */

export * from './types'
export { supabaseAuthProvider }

export function resolveAuthProvider(id: ProviderId<'auth'> = DEFAULT_PROVIDERS.auth): AuthProvider {
  return pickProvider('auth', id, {
    supabase: () => supabaseAuthProvider,
    builtin: () => builtinProvider('builtin'),
    oidc: () => builtinProvider('oidc'),
    saml: () => builtinProvider('saml'),
  })
}

const builtinCache = new Map<string, AuthProvider>()

function builtinProvider(id: 'builtin' | 'oidc' | 'saml'): AuthProvider {
  let provider = builtinCache.get(id)
  if (!provider) {
    provider = createBuiltinAuthProvider(id)
    builtinCache.set(id, provider)
  }
  return provider
}

/**
 * The configured auth provider id: AUTH_PROVIDER, else the `providers.auth`
 * instance setting, else supabase. Cheap: the settings come from the
 * in-process cache (30 s TTL).
 */
export async function activeAuthProviderId(): Promise<ProviderId<'auth'>> {
  const fromEnv = getEnvProviderOverrides().auth
  if (fromEnv) return fromEnv
  const stored = providerIdSchema('auth').safeParse((await loadInstanceSettings()).get('providers.auth'))
  return stored.success ? stored.data : DEFAULT_PROVIDERS.auth
}

export async function getAuthProvider(): Promise<AuthProvider> {
  return resolveAuthProvider(await activeAuthProviderId())
}
