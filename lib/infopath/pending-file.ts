/**
 * Carry an InfoPath file from the public "Migrate from InfoPath" page into
 * the importer — in THIS browser only. The file is kept in IndexedDB (never
 * sent anywhere or stored on the server) for at most an hour, and is taken
 * (read once and deleted) when the importer opens with ?import=infopath.
 * Signing up in another browser simply means choosing the file again.
 */

const DB = 'usertasks-infopath'
const STORE = 'pending'
const KEY = 'file'
export const PENDING_TTL_MS = 60 * 60 * 1000

interface Pending { name: string; type: string; data: Blob; saved: number }

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

/** Keep the file for the importer (true when it could be kept). */
export async function savePendingInfoPath(file: File): Promise<boolean> {
  const db = await open()
  if (!db) return false
  const value: Pending = { name: file.name, type: file.type, data: file, saved: Date.now() }
  const ok = await run(db, 'readwrite', (s) => s.put(value, KEY))
  db.close()
  return ok !== null
}

/** The kept file (once: it is deleted as it is read), or null when none / expired. */
export async function takePendingInfoPath(now = Date.now()): Promise<File | null> {
  const db = await open()
  if (!db) return null
  const value = await run<Pending>(db, 'readonly', (s) => s.get(KEY) as IDBRequest<Pending>)
  await run(db, 'readwrite', (s) => s.delete(KEY))
  db.close()
  if (!value || now - value.saved > PENDING_TTL_MS) return null
  return new File([value.data], value.name, { type: value.type })
}

/** Where the CTA goes: the importer when signed in, sign-up first otherwise (then the importer). */
export function importerHref(signedIn: boolean): string {
  return signedIn ? '/automations/forms?import=infopath' : '/start?next=infopath'
}
