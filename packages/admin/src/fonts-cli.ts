import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { StorageProvider, StoredObjectInfo } from '@/lib/providers/storage/types'

/**
 * usertasks-admin fonts — self-hosted Google Fonts (lib/fonts/serve.ts).
 *
 *   fonts status                         remote fetching on/off, families stored
 *   fonts seed <family>… [--featured] [--dir <folder>]
 *        fetch each family's stylesheet and every font file it names from
 *        Google into the storage provider (or, with --dir, into a folder to
 *        carry to an air-gapped install). Needs internet access.
 *   fonts import <folder>                load a seeded folder into the storage
 *        provider (no internet needed: run it on the air-gapped side).
 *
 * The folder holds the storage keys as paths (`google-fonts/css/…`,
 * `google-fonts/files/…`); only those shapes are imported.
 */

export interface FontsIO { out: (line: string) => void; err: (line: string) => void }

const KEY_RE = /^google-fonts\/(?:css\/[a-z0-9-]+\/w[0-9a-f]+(?:-i[0-9a-f]+)?\.css|files\/[a-z0-9]{1,64}\/v\d{1,4}\/[A-Za-z0-9_-]{1,200}\.woff2)$/

/** A folder as a storage provider (only what seeding uses). */
export function folderStorage(root: string): StorageProvider {
  const file = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error(`Unexpected font key ${key}`)
    return path.join(root, ...key.split('/'))
  }
  const info = (key: string, size: number): StoredObjectInfo => ({ key, size, contentType: null, etag: null, lastModified: null, cacheControl: null })
  const provider = {
    id: 'local',
    onPrem: true,
    async put(_bucket: string, key: string, body: unknown) {
      const target = file(key)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, body as Uint8Array)
    },
    async get(_bucket: string, key: string) {
      try {
        const bytes = await readFile(file(key))
        return { ...info(key, bytes.byteLength), body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close() } }) }
      } catch { return null }
    },
    async head(_bucket: string, key: string) {
      try { return info(key, (await stat(file(key))).size) } catch { return null }
    },
    async list() { return { objects: [], cursor: null } },
  }
  return provider as unknown as StorageProvider
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

export async function runFonts(action: 'status' | 'seed' | 'import', args: string[], values: { dir?: string; featured?: boolean; json?: boolean }, io: FontsIO): Promise<number> {
  const serve = await import('@/lib/fonts/serve')
  const { getStorageProvider } = await import('@/lib/providers/storage')
  if (action === 'status') {
    const status = await serve.fontStatus({ storage: getStorageProvider })
    if (values.json) { io.out(JSON.stringify(status, null, 2)); return 0 }
    io.out(`Remote fetching: ${status.remote ? 'on' : `off (${serve.FONTS_REMOTE_ENV} / ${serve.FONTS_REMOTE_SETTING})`}`)
    io.out(`Stored families (${status.stored.length}): ${status.stored.join(', ') || '(none)'}`)
    return 0
  }
  if (action === 'import') {
    const from = args[0]
    if (!from) { io.err('fonts import needs the folder written by `fonts seed --dir`'); return 2 }
    const root = path.resolve(from)
    const storage = await getStorageProvider()
    let n = 0
    for (const key of await walk(root)) {
      if (!KEY_RE.test(key)) continue
      const bytes = await readFile(path.join(root, ...key.split('/')))
      const css = key.endsWith('.css')
      if (!css && !serve.isWoff2(bytes)) { io.err(`skipped ${key}: not a woff2 font`); continue }
      await storage.put(serve.FONTS_BUCKET, key, bytes, { contentType: css ? 'text/css; charset=utf-8' : 'font/woff2', cacheControl: '31536000', upsert: true })
      n++
    }
    io.out(`Imported ${n} font file${n === 1 ? '' : 's'} into ${serve.FONTS_BUCKET}/${serve.FONTS_PREFIX}/`)
    return n ? 0 : 1
  }
  const families = [...args]
  if (values.featured) {
    const { CURATED_FAMILIES } = await import('@/lib/theme/fonts')
    families.push(...CURATED_FAMILIES)
  }
  if (!families.length) { io.err('fonts seed needs one or more family names (or --featured)'); return 2 }
  const storage = values.dir ? folderStorage(path.resolve(values.dir)) : await getStorageProvider()
  const deps = { storage: async () => storage, allowFetch: async () => true }
  let failed = 0
  for (const family of [...new Set(families)]) {
    try {
      const r = await serve.seedGoogleFont(family, deps)
      io.out(r.href ? `${r.family}: ${r.files} font files (${r.fetched} downloaded) → ${r.href}` : `${r.family}: bundled with the app, nothing to store`)
    } catch (error) {
      failed++
      io.err(`${family}: ${(error as Error).message}`)
    }
  }
  if (values.dir) io.out(`Written to ${path.resolve(values.dir)}. On the offline install: usertasks-admin fonts import <that folder>`)
  return failed ? 1 : 0
}
