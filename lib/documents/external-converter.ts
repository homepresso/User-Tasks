/**
 * Optional high-fidelity conversion through a Gotenberg-compatible service
 * (LibreOffice for Office → PDF, Chromium for HTML / Markdown → PDF).
 *
 *   DOCUMENT_CONVERTER_URL      e.g. http://gotenberg:3000 (self-hosted; never a public service)
 *   DOCUMENT_CONVERTER_TOKEN    optional bearer token (a proxy in front of it)
 *   DOCUMENT_CONVERTER_TIMEOUT_SECONDS  default 120
 *
 * The URL is instance configuration (an admin's choice), so private
 * addresses are allowed; the request carries only the file being converted.
 */

export function externalConverterConfigured(): boolean {
  return Boolean(process.env.DOCUMENT_CONVERTER_URL?.trim())
}

const OFFICE = new Set(['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv'])

export function externalCanConvert(fromExt: string, to: string): boolean {
  if (to !== 'pdf') return false
  return OFFICE.has(fromExt) || fromExt === 'html' || fromExt === 'md'
}

export async function convertExternally(bytes: Uint8Array, fileName: string, fromExt: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const base = String(process.env.DOCUMENT_CONVERTER_URL ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('No external converter is configured (DOCUMENT_CONVERTER_URL)')
  if (!/^https?:\/\//i.test(base)) throw new Error('DOCUMENT_CONVERTER_URL must be an http(s) URL')
  const form = new FormData()
  let route: string
  if (fromExt === 'html') {
    route = '/forms/chromium/convert/html'
    form.append('files', new Blob([new Uint8Array(bytes)], { type: 'text/html' }), 'index.html')
  } else if (fromExt === 'md') {
    route = '/forms/chromium/convert/markdown'
    form.append('files', new Blob(['<!doctype html><html><head><meta charset="utf-8"></head><body>{{ toHTML "file.md" }}</body></html>'], { type: 'text/html' }), 'index.html')
    form.append('files', new Blob([new Uint8Array(bytes)], { type: 'text/markdown' }), 'file.md')
  } else {
    route = '/forms/libreoffice/convert'
    const safe = fileName.replace(/[^\w.-]+/g, '_').replace(/\.[^.]*$/, '') || 'document'
    form.append('files', new Blob([new Uint8Array(bytes)]), `${safe}.${fromExt}`)
  }
  const token = process.env.DOCUMENT_CONVERTER_TOKEN?.trim()
  const timeout = Math.max(10, Math.min(900, Number(process.env.DOCUMENT_CONVERTER_TIMEOUT_SECONDS) || 120)) * 1000
  const res = await fetchImpl(`${base}${route}`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`The external converter failed (HTTP ${res.status})`)
  const out = new Uint8Array(await res.arrayBuffer())
  if (out.byteLength < 5 || String.fromCharCode(...out.subarray(0, 4)) !== '%PDF') throw new Error('The external converter did not return a PDF')
  return out
}
