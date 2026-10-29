import { afterEach, describe, expect, it, vi } from 'vitest'
import PizZip from 'pizzip'
import { openZip, ZipLimitError } from '@/lib/documents/zip'
import { parseXml, XmlSecurityError } from '@/lib/documents/xml'
import { readDocument } from '@/lib/documents/read'
import { extractPatterns } from '@/lib/documents/extract'
import { redactText } from '@/lib/documents/redact'
import { ownStorageDenied, resolveFileInput, decodeBase64 } from '@/lib/files/resolve-input'
import { assertInputSize, DOCUMENT_LIMITS } from '@/lib/documents/limits'
import { HTML } from './helpers/document-fixtures'

/**
 * Document actions: hostile input. Zip bombs (honest and lying headers), XXE
 * and entity expansion, oversized inputs, other tenants' storage objects,
 * SSRF through URLs and redirects, ReDoS patterns and active HTML content.
 */

const TENANT = '0fa00000-0000-4000-8000-00000000000a'
const OTHER = '0fa00000-0000-4000-8000-00000000000b'

function zipWith(files: Record<string, string>): Buffer {
  const zip = new PizZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

describe('zip bombs', () => {
  it('refuses parts whose declared size is over the cap', () => {
    const bomb = zipWith({ 'word/document.xml': '0'.repeat(3 * 1024 * 1024) })
    expect(bomb.byteLength).toBeLessThan(20_000) // tiny on disk
    expect(() => openZip(bomb, { maxEntryBytes: 1024 * 1024 })).toThrow(ZipLimitError)
  })

  it('stops inflating at the cap even when the header lies about the size', () => {
    const bomb = zipWith({ 'word/document.xml': '0'.repeat(3 * 1024 * 1024) })
    // Patch the central directory's uncompressed size to 100 bytes.
    const eocd = bomb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const cd = bomb.readUInt32LE(eocd + 16)
    bomb.writeUInt32LE(100, cd + 24)
    const zip = openZip(bomb, { maxEntryBytes: 1024 * 1024 })
    expect(() => zip.read('word/document.xml')).toThrow(ZipLimitError)
  })

  it('caps the total unpacked size and the number of parts', () => {
    const many: Record<string, string> = {}
    for (let k = 0; k < 30; k++) many[`p${k}.xml`] = 'x'.repeat(100_000)
    expect(() => openZip(zipWith(many), { maxTotalBytes: 1024 * 1024 })).toThrow(/too large when unpacked/)
    expect(() => openZip(zipWith(many), { maxEntries: 10 })).toThrow(/too many parts/)
  })

  it('a bomb inside a .docx fails cleanly through Read document', async () => {
    const prev = process.env.DOCUMENT_MAX_UNPACKED_MB
    process.env.DOCUMENT_MAX_UNPACKED_MB = '10'
    try {
      const bomb = zipWith({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${'A'.repeat(12 * 1024 * 1024)}</w:t></w:r></w:p></w:body></w:document>` })
      await expect(readDocument(bomb, 'bomb.docx', null)).rejects.toThrow(/too large when unpacked/)
    } finally {
      if (prev === undefined) delete process.env.DOCUMENT_MAX_UNPACKED_MB
      else process.env.DOCUMENT_MAX_UNPACKED_MB = prev
    }
  })
})

describe('XML: XXE and entity expansion', () => {
  const XXE = '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>'
  const LAUGHS = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>'

  it('refuses any DOCTYPE', () => {
    expect(() => parseXml(XXE)).toThrow(XmlSecurityError)
    expect(() => parseXml(LAUGHS)).toThrow(XmlSecurityError)
  })

  it('an XML file or a .docx part with an external entity is refused', async () => {
    await expect(readDocument(Buffer.from(XXE), 'evil.xml', null)).rejects.toThrow(/DOCTYPE/)
    const docx = zipWith({ '[Content_Types].xml': '<Types/>', 'word/document.xml': XXE.replace('<foo>', '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>').replace('</foo>', '</w:t></w:r></w:p></w:body></w:document>') })
    await expect(readDocument(docx, 'evil.docx', null)).rejects.toThrow(/DOCTYPE/)
  })

  it('unknown entities are never expanded; numeric references are', () => {
    const el = parseXml('<a>&amp;&#65;&#x42;&nope;</a>')
    expect(el.children).toEqual(['&AB&nope;'])
  })

  it('deep nesting is bounded', () => {
    expect(() => parseXml(`${'<a>'.repeat(600)}${'</a>'.repeat(600)}`)).toThrow(/nested too deeply/)
  })
})

describe('size limits', () => {
  it('input size cap (DOCUMENT_MAX_MB)', async () => {
    expect(() => assertInputSize(30 * 1024 * 1024, 'big.pdf')).toThrow(/too large/)
    await expect(resolveFileInput({ base64: Buffer.alloc(2048).toString('base64'), name: 'x.bin' }, { tenantId: TENANT, maxBytes: 1024 })).rejects.toThrow(/too large/)
    expect(DOCUMENT_LIMITS.maxInputBytes).toBe(25 * 1024 * 1024)
  })
})

describe('storage references are tenant-scoped', () => {
  it('own workflow files only; other tenants, private buckets and unknown buckets are refused', () => {
    expect(ownStorageDenied(`storage://task-files/workflow-files/${TENANT}/a.pdf`, TENANT)).toBeNull()
    expect(ownStorageDenied(`storage://task-files/workflow-files/${OTHER}/a.pdf`, TENANT)).toBe('another tenant')
    expect(ownStorageDenied(`storage://logos/${OTHER}/logo.png`, TENANT)).toBe('another tenant')
    expect(ownStorageDenied(`storage://job-results/${TENANT}/job/out.csv`, TENANT)).toBe('private object')
    expect(ownStorageDenied('https://example.com/file.pdf', TENANT)).toBeNull() // not own storage: the egress guard applies
  })

  it('a reference to another tenant\'s file is "not found" (no fetch made)', async () => {
    const fetchSpy = vi.fn()
    await expect(resolveFileInput(`storage://task-files/workflow-files/${OTHER}/secret.pdf`, { tenantId: TENANT, fetchImpl: fetchSpy })).rejects.toThrow(/file not found/)
    await expect(resolveFileInput({ name: 'x', storage_ref: `storage://task-files/workflow-files/${OTHER}/secret.pdf` }, { tenantId: TENANT, fetchImpl: fetchSpy })).rejects.toThrow(/file not found/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('path traversal in a reference is not an own object', async () => {
    await expect(resolveFileInput(`storage://task-files/workflow-files/${TENANT}/../${OTHER}/x.pdf`, { tenantId: TENANT })).rejects.toThrow()
  })
})

describe('URLs go through the egress guard (redirects re-checked)', () => {
  afterEach(() => { delete process.env.ALLOW_PRIVATE_EGRESS })

  it('blocks metadata and private addresses', async () => {
    const fetchSpy = vi.fn()
    await expect(resolveFileInput('http://169.254.169.254/latest/meta-data', { tenantId: TENANT, fetchImpl: fetchSpy })).rejects.toThrow(/not allowed/)
    await expect(resolveFileInput('http://127.0.0.1:5432/x', { tenantId: TENANT, fetchImpl: fetchSpy })).rejects.toThrow(/not allowed/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a public URL that redirects to a private address is blocked', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/secret' } }))
    await expect(resolveFileInput('https://93.184.216.34/file.pdf', { tenantId: TENANT, fetchImpl: fetchSpy as never })).rejects.toThrow(/not allowed/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('streams with a size cap even when Content-Length is missing', async () => {
    const big = new ReadableStream({ start(c) { for (let k = 0; k < 20; k++) c.enqueue(new Uint8Array(1024)); c.close() } })
    const fetchSpy = vi.fn(async () => new Response(big))
    await expect(resolveFileInput('https://93.184.216.34/big.bin', { tenantId: TENANT, maxBytes: 4096, fetchImpl: fetchSpy as never })).rejects.toThrow(/too large/)
  })
})

describe('active content and patterns', () => {
  it('HTML outputs never carry scripts, handlers, iframes or javascript: links', async () => {
    const r = await readDocument(Buffer.from(HTML), 'x.html', null)
    expect(r.html).not.toMatch(/<script|<style|<iframe|on\w+=|javascript:/i)
    const md = await readDocument(Buffer.from('[x](javascript:alert(1)) <a href="javascript:alert(2)">y</a> <svg onload=alert(3)>'), 'x.md', null)
    expect(md.html).not.toMatch(/javascript:|onload|<svg/i)
  })

  it('ReDoS-shaped patterns are rejected (Extract / Redact)', () => {
    const r = extractPatterns('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!', [{ name: 'x', pattern: '(a+)+$' }])
    expect(r.errors.join(' ')).toMatch(/exponential/)
    expect(() => redactText('aaaa', { patterns: ['(a*)*b'] })).toThrow(/exponential/)
  })

  it('base64 decoding refuses non-base64', () => {
    expect(decodeBase64('not base64!')).toBeNull()
    expect(Buffer.from(decodeBase64('aGk=')!).toString()).toBe('hi')
  })

  it('an encrypted (password-protected) PDF fails with a clear message', async () => {
    // A minimal PDF trailer with /Encrypt.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n3 0 obj<</Filter/Standard/V 1/R 2/O(xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)/U(xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)/P -4>>endobj\ntrailer<</Root 1 0 R/Encrypt 3 0 R/ID[<00><00>]>>\n%%EOF')
    const { loadPdf } = await import('@/lib/documents/pdf-tools')
    await expect(loadPdf(pdf, 'locked.pdf')).rejects.toThrow(/encrypted/)
  })
})

describe('phone numbers with a one-digit area code', () => {
  it('are redacted whole, country code included', () => {
    expect(redactText('Call +64 9 555 0100 or +64 21 555 0100.', { presets: ['phone'], replacement: 'label' }).text).toBe('Call [PHONE] or [PHONE].')
  })
})
