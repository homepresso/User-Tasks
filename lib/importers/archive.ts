/**
 * ctx.archives.unpack: the entries of a zip or a CAB (MSZIP / uncompressed)
 * archive for importers — a SharePoint solution (.wsp is a CAB), a zipped
 * export folder. Bounded like the InfoPath reader (files, per-file and total
 * unpacked size: archive bombs stop at the cap). Server-only.
 */

import { ExtensionError } from '@/lib/extensions/sdk'
import { CabError, isCab, readCab } from '@/lib/infopath/cab'
import { isZip, openZip, ZipLimitError } from '@/lib/documents/zip'

const MB = 1024 * 1024

export interface UnpackOptions { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number }

export function unpackArchive(bytes: Uint8Array, options: UnpackOptions = {}): { format: 'zip' | 'cab'; entries: Array<{ name: string; bytes: Uint8Array }> } {
  const maxFiles = Math.min(options.maxFiles ?? 2000, 5000)
  const maxFileBytes = Math.min(options.maxFileBytes ?? 32 * MB, 64 * MB)
  const maxTotalBytes = Math.min(options.maxTotalBytes ?? 96 * MB, 200 * MB)
  const clean = (name: string) => name.replace(/\\/g, '/').replace(/^\/+/, '')
  if (isCab(bytes)) {
    try {
      return { format: 'cab', entries: readCab(bytes, { maxFiles, maxFileBytes, maxTotalBytes }).map((f) => ({ name: clean(f.name), bytes: new Uint8Array(f.data) })) }
    } catch (error) {
      if (error instanceof CabError) throw new ExtensionError('invalid_archive', error.code === 'lzx' ? 'This cabinet uses LZX compression, which is not supported: rebuild it with MSZIP (makecab default) or zip the files.' : `The cabinet could not be read: ${error.message}`, 400)
      throw error
    }
  }
  if (isZip(bytes)) {
    try {
      const zip = openZip(bytes, { maxEntries: maxFiles, maxEntryBytes: maxFileBytes, maxTotalBytes })
      const entries: Array<{ name: string; bytes: Uint8Array }> = []
      for (const name of zip.names()) {
        if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue
        const data = zip.read(name)
        if (data) entries.push({ name: clean(name), bytes: new Uint8Array(data) })
      }
      return { format: 'zip', entries }
    } catch (error) {
      if (error instanceof ZipLimitError) throw new ExtensionError('invalid_archive', error.message, 400)
      throw new ExtensionError('invalid_archive', `The zip could not be read: ${(error as Error).message}`, 400)
    }
  }
  throw new ExtensionError('invalid_archive', 'Not a zip or CAB (.wsp / .cab) archive', 400)
}
