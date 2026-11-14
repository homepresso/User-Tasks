/**
 * TLS channel binding for Extended Protection for Authentication (EPA):
 * `tls-server-end-point` (RFC 5929) — the hash of the server's certificate,
 * with the certificate's own signature hash, upgraded to SHA-256 when that
 * is MD5 or SHA-1. Server-only.
 */
import { createHash } from 'node:crypto'

const PREFIX = Buffer.from('tls-server-end-point:', 'ascii')

/** Signature algorithm OIDs → the hash RFC 5929 uses for them. */
const SIGNATURE_HASH: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'sha256', // md5WithRSA → SHA-256
  '1.2.840.113549.1.1.5': 'sha256', // sha1WithRSA → SHA-256
  '1.2.840.113549.1.1.11': 'sha256',
  '1.2.840.113549.1.1.12': 'sha384',
  '1.2.840.113549.1.1.13': 'sha512',
  '1.2.840.113549.1.1.14': 'sha256', // sha224WithRSA (no SHA-224 binding in practice; Windows uses SHA-256)
  '1.2.840.10045.4.1': 'sha256', // ecdsa-with-SHA1 → SHA-256
  '1.2.840.10045.4.3.2': 'sha256',
  '1.2.840.10045.4.3.3': 'sha384',
  '1.2.840.10045.4.3.4': 'sha512',
  '1.2.840.10040.4.3': 'sha256', // dsa-with-sha1
  '2.16.840.1.101.3.4.3.2': 'sha256', // dsa-with-sha256
}

const HASH_OIDS: Record<string, string> = {
  '1.3.14.3.2.26': 'sha256', // SHA-1 → SHA-256
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
}

const RSASSA_PSS = '1.2.840.113549.1.1.10'

interface Tlv { tag: number; start: number; contentStart: number; end: number }

function readTlv(buf: Buffer, at: number): Tlv {
  if (at + 2 > buf.length) throw new Error('truncated DER')
  const tag = buf[at]
  let len = buf[at + 1]
  let contentStart = at + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4 || contentStart + n > buf.length) throw new Error('bad DER length')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[contentStart + i]
    contentStart += n
  }
  const end = contentStart + len
  if (end > buf.length) throw new Error('DER element runs past the buffer')
  return { tag, start: at, contentStart, end }
}

function decodeOid(bytes: Buffer): string {
  if (bytes.length === 0) return ''
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40]
  let value = 0
  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f)
    if (!(bytes[i] & 0x80)) { parts.push(value); value = 0 }
  }
  return parts.join('.')
}

/** The hash name (sha256 / sha384 / sha512) for a DER certificate's tls-server-end-point binding. */
export function certificateBindingHash(der: Buffer): string {
  try {
    const cert = readTlv(der, 0) // Certificate SEQUENCE
    const tbs = readTlv(der, cert.contentStart)
    const sigAlg = readTlv(der, tbs.end) // AlgorithmIdentifier SEQUENCE
    const oidTlv = readTlv(der, sigAlg.contentStart)
    if (oidTlv.tag !== 0x06) return 'sha256'
    const oid = decodeOid(der.subarray(oidTlv.contentStart, oidTlv.end))
    if (oid === RSASSA_PSS && oidTlv.end < sigAlg.end) {
      // RSASSA-PSS-params ::= SEQUENCE { [0] hashAlgorithm AlgorithmIdentifier DEFAULT sha1, … }
      const params = readTlv(der, oidTlv.end)
      if (params.tag === 0x30 && params.contentStart < params.end) {
        const first = readTlv(der, params.contentStart)
        if (first.tag === 0xa0) {
          const alg = readTlv(der, first.contentStart)
          const hashOid = readTlv(der, alg.contentStart)
          if (hashOid.tag === 0x06) return HASH_OIDS[decodeOid(der.subarray(hashOid.contentStart, hashOid.end))] ?? 'sha256'
        }
      }
      return 'sha256'
    }
    return SIGNATURE_HASH[oid] ?? 'sha256'
  } catch {
    return 'sha256'
  }
}

/** `tls-server-end-point:` + hash(certificate DER): the channel-binding application data. */
export function tlsServerEndPoint(der: Buffer): Buffer {
  const hash = createHash(certificateBindingHash(der)).update(der).digest()
  return Buffer.concat([PREFIX, hash])
}
