import { sanitizeSvg } from '@/lib/sanitize-svg'

/**
 * Custom app icons (uploaded SVG; pure, __tests__/apps-icons.test.ts).
 *
 * An icon value is a built-in icon name (lucide) or `svg:<uuid>` — an icon
 * from the workspace's uploaded-icon library. Uploads are cleaned with the
 * repo's SVG sanitiser (lib/sanitize-svg.ts) plus the extra rules below,
 * stored through the storage provider and always drawn through <img> or a
 * CSS mask (never inlined), served by /files with nosniff and a sandboxing
 * CSP (lib/storage/serve.ts).
 */

export const APP_ICON_MAX_BYTES = 100 * 1024
export const MAX_LIBRARY_ICONS = 200
const SVG_TOKEN_RE = /^svg:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export function customIconId(value: string | null | undefined): string | null {
  const m = SVG_TOKEN_RE.exec(String(value ?? ''))
  return m ? m[1].toLowerCase() : null
}

export function customIconToken(id: string): string {
  return `svg:${id}`
}

/**
 * A safe SVG from an upload, or null: the XML prolog / doctype dropped,
 * whitespace collapsed, then the sanitiser (scripts, foreignObject, <use>,
 * event handlers, javascript:/data: URLs) and, on top: external references
 * (http(s) / protocol-relative hrefs), CSS url() other than local #ids,
 * @import and <image> with a non-raster data URL.
 */
export function cleanAppIconSvg(raw: string): string | null {
  if (!raw || raw.length > APP_ICON_MAX_BYTES) return null
  let text = raw.replace(/^﻿?\s*(<\?xml[\s\S]*?\?>\s*)?(<!DOCTYPE[^>]*>\s*)?/i, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim()
  const clean = sanitizeSvg(text)
  if (!clean) return null
  text = clean
  // External references in any attribute (href, xlink:href, src, etc.).
  text = text.replace(/\s[a-z:-]+\s*=\s*("\s*(?:https?:)?\/\/[^"]*"|'\s*(?:https?:)?\/\/[^']*')/gi, '')
  // CSS url() pointing anywhere but a local fragment, and @import.
  text = text.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none')
  text = text.replace(/@import[^;"']*;?/gi, '')
  // Data URLs other than raster images.
  text = text.replace(/\s[a-z:-]+\s*=\s*("data:(?!image\/(?:png|jpeg|gif|webp);base64,)[^"]*"|'data:(?!image\/(?:png|jpeg|gif|webp);base64,)[^']*')/gi, '')
  if (!/^<svg[\s>]/i.test(text)) return null
  return text
}
