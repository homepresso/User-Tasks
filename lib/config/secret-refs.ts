import { ConfigError } from './schema'

/**
 * Secret references in provider options: `secret://<name>` or
 * `secret://<name>#<field>`. Any `<area>.<option>` value (env variable or
 * instance setting) may be one; lib/config resolves it from the configured
 * secret store when the area's config is read, so providers only ever see
 * plain values:
 *
 *   SMTP_PASSWORD=secret://usertasks/smtp#password
 *   storage.secret_access_key = "secret://minio-secret-key"
 *
 * Values are cached per store for the TTL (secrets.cache_ttl_seconds,
 * default 300 s) so rotation is picked up without a restart; failures are
 * cached for 10 s so a broken reference doesn't hammer the store. Error
 * messages name the option, the secret and the store — never a value.
 */

export const SECRET_REF_PREFIX = 'secret://'
export const DEFAULT_SECRET_TTL_MS = 300_000
const FAILURE_TTL_MS = 10_000

export interface SecretSource {
  readonly id: string
  get(name: string): Promise<string | undefined>
  getField?(name: string, field: string): Promise<string | undefined>
}

export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith(SECRET_REF_PREFIX)
}

export function parseSecretRef(ref: string): { name: string; field?: string } {
  const body = ref.trim().slice(SECRET_REF_PREFIX.length)
  const hash = body.indexOf('#')
  const name = decodeURIComponent(hash === -1 ? body : body.slice(0, hash))
  const field = hash === -1 ? undefined : decodeURIComponent(body.slice(hash + 1))
  if (!name) throw new ConfigError(`Invalid secret reference "${ref.slice(0, 80)}"`)
  return field ? { name, field } : { name }
}

export function hasSecretRefs(options: Record<string, unknown>): boolean {
  return Object.values(options).some(isSecretRef)
}

type Entry = { at: number; ttl: number; value?: string; error?: string }
const cache = new Map<string, Entry>()

export function clearSecretCache(): void {
  cache.clear()
}

async function lookup(store: SecretSource, name: string, field: string | undefined): Promise<string | undefined> {
  if (field && store.getField) return store.getField(name, field)
  const value = await store.get(name)
  if (value === undefined || !field) return value
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('the secret is not a JSON object, so it has no fields')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the secret is not a JSON object, so it has no fields')
  const picked = (parsed as Record<string, unknown>)[field]
  return picked === undefined || picked === null ? undefined : typeof picked === 'string' ? picked : JSON.stringify(picked)
}

/** One reference's value. Throws ConfigError (missing secret, store failure). */
export async function resolveSecretRef(
  ref: string,
  store: SecretSource,
  { label = ref, ttlMs = DEFAULT_SECRET_TTL_MS, now = Date.now }: { label?: string; ttlMs?: number; now?: () => number } = {},
): Promise<string> {
  const { name, field } = parseSecretRef(ref)
  const key = `${store.id}\u0000${name}\u0000${field ?? ''}`
  const what = `secret "${name}"${field ? ` (field "${field}")` : ''}`
  const hit = cache.get(key)
  if (hit && now() - hit.at < hit.ttl) {
    if (hit.value !== undefined) return hit.value
    throw new ConfigError(`${label}: ${hit.error}`)
  }
  let value: string | undefined
  try {
    value = await lookup(store, name, field)
  } catch (error) {
    const message = `${what} could not be read from the ${store.id} secret store: ${(error as Error).message}`
    cache.set(key, { at: now(), ttl: Math.min(ttlMs, FAILURE_TTL_MS), error: message })
    throw new ConfigError(`${label}: ${message}`)
  }
  if (value === undefined || value === '') {
    const message = `${what} was not found in the ${store.id} secret store`
    cache.set(key, { at: now(), ttl: Math.min(ttlMs, FAILURE_TTL_MS), error: message })
    throw new ConfigError(`${label}: ${message}`)
  }
  cache.set(key, { at: now(), ttl: ttlMs, value })
  return value
}

/** A copy of `options` with every secret reference replaced by its value. */
export async function resolveSecretRefs(
  area: string,
  options: Record<string, unknown>,
  store: SecretSource,
  ttlMs = DEFAULT_SECRET_TTL_MS,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = { ...options }
  await Promise.all(
    Object.entries(options)
      .filter(([, value]) => isSecretRef(value))
      .map(async ([option, ref]) => {
        resolved[option] = await resolveSecretRef(ref as string, store, { label: `${area}.${option}`, ttlMs })
      }),
  )
  return resolved
}

/** secrets.cache_ttl_seconds → ms (0 disables caching). */
export function secretTtlMs(options: Record<string, unknown>): number {
  const raw = options.cache_ttl_seconds
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SECRET_TTL_MS
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_SECRET_TTL_MS
}
