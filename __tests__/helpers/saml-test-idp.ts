import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'

/**
 * Test SAML IdP: builds SAML 2.0 Responses and signs them with xml-crypto
 * (a dependency of @node-saml/node-saml). Two throwaway self-signed key
 * pairs (the trusted IdP, and an untrusted one) are generated with the
 * openssl CLI into a temp directory when this module loads — no keys live in
 * the repository. `HAS_OPENSSL` is false when the CLI isn't available.
 */

function keyPair(dir: string, name: string): { key: string; cert: string } {
  const key = path.join(dir, `${name}-key.pem`)
  const cert = path.join(dir, `${name}-cert.pem`)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', `/CN=${name}`], { stdio: 'ignore' })
  return { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') }
}

let pairs: { idp: { key: string; cert: string }; other: { key: string; cert: string } } | null = null
try {
  const dir = mkdtempSync(path.join(tmpdir(), 'ut-saml-idp-'))
  pairs = { idp: keyPair(dir, 'usertasks-test-saml-idp'), other: keyPair(dir, 'untrusted-idp') }
} catch {
  pairs = null
}

export const HAS_OPENSSL = pairs !== null
export const IDP_KEY = pairs?.idp.key ?? ''
export const IDP_CERT = pairs?.idp.cert ?? ''
export const OTHER_KEY = pairs?.other.key ?? ''
export const OTHER_CERT = pairs?.other.cert ?? ''

export interface SamlResponseOptions {
  issuer: string
  audience: string
  acsUrl: string
  nameId: string
  attributes?: Record<string, string | string[]>
  inResponseTo?: string
  /** Seconds from now (negative = in the past). */
  notOnOrAfterSeconds?: number
  notBeforeSeconds?: number
  assertionId?: string
  sign?: 'assertion' | 'none'
  key?: string
  cert?: string
  /** Applied to the XML after signing (tampering). */
  mutate?: (xml: string) => string
}

const iso = (offsetSeconds: number) => new Date(Date.now() + offsetSeconds * 1000).toISOString()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function buildSamlResponse(opts: SamlResponseOptions): Promise<string> {
  const assertionId = opts.assertionId ?? `_a${randomBytes(12).toString('hex')}`
  const notOnOrAfter = iso(opts.notOnOrAfterSeconds ?? 300)
  const notBefore = iso(opts.notBeforeSeconds ?? -30)
  const irt = opts.inResponseTo ? ` InResponseTo="${esc(opts.inResponseTo)}"` : ''
  const attributes = Object.entries(opts.attributes ?? {})
    .map(([name, value]) => `<saml:Attribute Name="${esc(name)}">${(Array.isArray(value) ? value : [value]).map((v) => `<saml:AttributeValue>${esc(v)}</saml:AttributeValue>`).join('')}</saml:Attribute>`)
    .join('')
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(0)}">` +
    `<saml:Issuer>${esc(opts.issuer)}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${esc(opts.nameId)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${esc(opts.acsUrl)}"${irt}/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${esc(opts.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="_s${randomBytes(6).toString('hex')}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    (attributes ? `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` : '') +
    `</saml:Assertion>`
  let xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomBytes(12).toString('hex')}" Version="2.0" IssueInstant="${iso(0)}" Destination="${esc(opts.acsUrl)}"${irt}>` +
    `<saml:Issuer>${esc(opts.issuer)}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    assertion +
    `</samlp:Response>`

  if ((opts.sign ?? 'assertion') === 'assertion') {
    const { SignedXml } = await import('xml-crypto')
    const sig = new SignedXml({
      privateKey: opts.key ?? IDP_KEY,
      publicCert: opts.cert ?? IDP_CERT,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    })
    sig.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    })
    sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } })
    xml = sig.getSignedXml()
  }
  if (opts.mutate) xml = opts.mutate(xml)
  return Buffer.from(xml, 'utf8').toString('base64')
}

/** The AuthnRequest id and RelayState from an SP-initiated redirect URL (HTTP-Redirect binding). */
export function readAuthnRequest(redirectUrl: string): { id: string; relayState: string | null; xml: string } {
  const url = new URL(redirectUrl)
  const xml = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64')).toString('utf8')
  const id = /\bID="([^"]+)"/.exec(xml)?.[1]
  if (!id) throw new Error('no AuthnRequest ID')
  return { id, relayState: url.searchParams.get('RelayState'), xml }
}
