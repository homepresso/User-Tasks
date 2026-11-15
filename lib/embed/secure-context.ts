/**
 * Embedded pages inside a plain-http host page (lib/embed/designers.ts).
 *
 * A frame is a secure context only when every ancestor is: UserTasks on
 * https framed by an intranet page on http (common for on-premises
 * SharePoint farms) is NOT one, so `crypto.randomUUID` is missing there and
 * the designers' "add a step / variable / field" fails. `getRandomValues`
 * stays available, so a v4 UUID is built from it. Other secure-context-only
 * APIs (the async clipboard, for instance) stay unavailable in such frames.
 */

export function uuidV4(getRandomValues: (a: Uint8Array) => Uint8Array): string {
  const b = getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Give `crypto.randomUUID` to a non-secure context that lacks it (no-op elsewhere). */
export function ensureRandomUUID(c: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined): void {
  if (!c || typeof c.randomUUID === 'function' || typeof c.getRandomValues !== 'function') return
  try {
    Object.defineProperty(c, 'randomUUID', { value: () => uuidV4((a) => c.getRandomValues(a)), configurable: true, writable: true })
  } catch { /* frozen: nothing to do */ }
}
