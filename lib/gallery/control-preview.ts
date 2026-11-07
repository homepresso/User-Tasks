/**
 * The website's live preview of an official form control
 * (/gallery/controls/<slug>): the control runs in exactly the sandboxed frame
 * the app uses (lib/forms/custom-controls/frame.ts — opaque origin, its own
 * CSP, scripts by hash), served from /form-controls/frame/gallery/<slug>.
 *
 * The module comes from the published, checksummed .utpkg in public/gallery
 * (never from the sources), so the preview shows what an install gets. The
 * preview approves the control's declared hosts (official map tiles) — in a
 * workspace an admin approves them after install.
 *
 * Node only (fs).
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFrameDocument, FRAME_HEADERS, frameContentSecurityPolicy, frameErrorDocument } from '@/lib/forms/custom-controls/frame'
import { parseFormControlManifest } from '@/lib/forms/custom-controls/manifest'
import type { FormControlManifest } from '@/lib/forms/custom-controls/contract'
import { fromPackageFiles } from '@/lib/packages/build'
import { unpackPackage } from '@/lib/packages/format'
import { GALLERY_OUTPUT_DIR } from './source'
import { getGalleryControl } from './site'

const cache = new Map<string, { manifest: FormControlManifest; bundle: string }>()

/** The control module of a gallery control page (null: no such single control). */
export function galleryControlModule(slug: string): { manifest: FormControlManifest; bundle: string } | null {
  const entry = getGalleryControl(slug)
  if (!entry || entry.kind !== 'form_control') return null
  const key = `${entry.file.file_name}:${entry.file.sha256}`
  const hit = cache.get(key)
  if (hit) return hit
  const bytes = new Uint8Array(readFileSync(join(GALLERY_OUTPUT_DIR, entry.file.file_name)))
  if (createHash('sha256').update(bytes).digest('hex') !== entry.file.sha256) throw new Error('The gallery file does not match its index entry')
  const unpacked = unpackPackage(bytes)
  if (!unpacked.verification.valid) throw new Error('The gallery package failed verification')
  const { contents } = fromPackageFiles(unpacked.manifest, unpacked.files)
  const asset = ((contents.assets as Record<string, Array<Record<string, unknown>>>).form_controls ?? [])[0]
  const version = ((asset?.versions ?? []) as Array<{ version: string; manifest: unknown; bundle: string }>).find((v) => v.version === entry.version)
  if (!version) return null
  const loaded = { manifest: parseFormControlManifest(version.manifest), bundle: String(version.bundle) }
  cache.set(key, loaded)
  return loaded
}

const ERROR_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox; base-uri 'none'; form-action 'none'"

/** The sandboxed frame document of a gallery control's preview. */
export function serveGalleryControlFrame(request: Request, slug: string): Response {
  try {
    const loaded = galleryControlModule(slug)
    if (!loaded) {
      return new Response(frameErrorDocument('No such control'), { status: 404, headers: { ...FRAME_HEADERS, 'Cache-Control': 'no-store', 'Content-Security-Policy': ERROR_CSP } })
    }
    const { html, scripts } = buildFrameDocument(loaded.manifest, loaded.bundle)
    const hashes = scripts.map((s) => createHash('sha256').update(s, 'utf8').digest('base64'))
    return new Response(request.method === 'HEAD' ? null : html, {
      status: 200,
      headers: {
        ...FRAME_HEADERS,
        'Cache-Control': 'public, max-age=3600',
        'Content-Security-Policy': frameContentSecurityPolicy({ scriptHashes: hashes, approvedHosts: loaded.manifest.network?.allowed_hosts ?? [] }),
      },
    })
  } catch (error) {
    console.error('[gallery.control-preview]', error)
    return new Response(frameErrorDocument('This preview could not be loaded'), { status: 500, headers: { ...FRAME_HEADERS, 'Cache-Control': 'no-store', 'Content-Security-Policy': ERROR_CSP } })
  }
}
