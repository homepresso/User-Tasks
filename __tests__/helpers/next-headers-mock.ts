/**
 * In-memory stand-in for next/headers in auth tests:
 *   vi.mock('next/headers', () => import('./helpers/next-headers-mock'))
 * `jar` is the browser's cookie jar for the simulated request; every set is
 * also recorded in `cookieWrites` (with its options) so tests can assert
 * HttpOnly / Secure / SameSite flags.
 */

export interface CookieWrite {
  name: string
  value: string
  options: Record<string, unknown>
}

export const jar = new Map<string, string>()
export const cookieWrites: CookieWrite[] = []
export const requestHeaders = new Headers()

export function resetRequest(): void {
  jar.clear()
  cookieWrites.length = 0
  for (const key of [...requestHeaders.keys()]) requestHeaders.delete(key)
}

const store = {
  get(name: string) {
    const value = jar.get(name)
    return value === undefined ? undefined : { name, value }
  },
  getAll() {
    return [...jar.entries()].map(([name, value]) => ({ name, value }))
  },
  has(name: string) {
    return jar.has(name)
  },
  set(name: string, value: string, options: Record<string, unknown> = {}) {
    cookieWrites.push({ name, value, options })
    if (value === '' || options.maxAge === 0) jar.delete(name)
    else jar.set(name, value)
  },
  delete(name: string) {
    cookieWrites.push({ name, value: '', options: { maxAge: 0 } })
    jar.delete(name)
  },
}

export async function cookies() {
  return store
}

export async function headers() {
  return requestHeaders
}

export async function draftMode() {
  return { isEnabled: false }
}
