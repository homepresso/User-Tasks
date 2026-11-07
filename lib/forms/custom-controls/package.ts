/**
 * Custom form control packages: what an upload (or a URL import) turns
 * into before it is stored as an immutable version — the validated
 * manifest, the ES module text, its SHA-256 and an optional signature.
 *
 * Accepted shapes:
 *   - a .zip with manifest.json (at the root, or inside one top-level
 *     folder) and the module (manifest `entry`, else the only .js / .mjs
 *     file, else index.js / dist/index.js); README / LICENSE are ignored;
 *     signature.json ({ alg: 'ed25519', public_key: <base64 SPKI DER or
 *     PEM>, signature: <base64 over the module's SHA-256 hex> }) optional;
 *   - a module (text) plus the manifest (JSON).
 *
 * The module must be ONE self-contained ES module: it runs inline in the
 * frame with no network, so static imports of other files or packages are
 * refused with a hint to bundle them. Server only (node:crypto).
 */

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { isPlainObject } from '@/lib/utils/guards'
import { PACKAGE_LIMITS, type FormControlManifest } from './contract'
import { ManifestError, parseFormControlManifest } from './manifest'

export interface ControlSignature {
  alg: 'ed25519'
  /** SHA-256 fingerprint of the public key (hex), for admins to compare with the publisher's. */
  key_fingerprint: string
  /** The signature verifies against the module checksum with the included key. */
  verified: boolean
  /**
   * 'package': no signature.json of its own — the version came in a signed
   * package (.utpkg, e.g. the official gallery) whose signature verified;
   * key_fingerprint is then the package signer's fingerprint.
   */
  via?: 'package'
}

export interface ParsedControlPackage {
  manifest: FormControlManifest
  bundle: string
  sha256: string
  size_bytes: number
  signature: ControlSignature | null
  /** Non-blocking findings (shown after the upload). */
  warnings: string[]
}

export class PackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackageError'
  }
}

export function sha256Hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex')
}

export function sha256Base64(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64')
}

const IMPORT_RE = /(?:^|[;\n}\s])import\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g
const EXPORT_FROM_RE = /(?:^|[;\n}\s])export\s*[\w$*{}\s,]*?\s*from\s*["']([^"']+)["']/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g

/** Problems with the module text (empty list = acceptable). */
export function moduleProblems(bundle: string): string[] {
  const problems: string[] = []
  if (!bundle.trim()) return ['The module is empty']
  if (Buffer.byteLength(bundle, 'utf8') > PACKAGE_LIMITS.moduleBytes) problems.push(`The module is larger than ${PACKAGE_LIMITS.moduleBytes / 1024} KB`)
  const specifiers = new Set<string>()
  for (const re of [IMPORT_RE, EXPORT_FROM_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(bundle))) specifiers.add(m[1])
  }
  const external = [...specifiers].filter((s) => !s.startsWith('data:'))
  if (external.length) {
    problems.push(`The module imports ${external.slice(0, 3).map((s) => `"${s}"`).join(', ')}${external.length > 3 ? '…' : ''} — bundle every dependency into one ES module (the starter kit's build does this)`)
  }
  return problems
}

export function verifyPackageSignature(raw: unknown, sha: string): ControlSignature | null {
  if (!isPlainObject(raw)) return null
  if (raw.alg !== 'ed25519' || typeof raw.public_key !== 'string' || typeof raw.signature !== 'string') {
    throw new PackageError('signature.json must be { "alg": "ed25519", "public_key": "…", "signature": "…" }')
  }
  let key
  try {
    const text = raw.public_key.trim()
    key = text.includes('BEGIN PUBLIC KEY')
      ? createPublicKey(text)
      : createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' })
  } catch {
    throw new PackageError('signature.json: the public key could not be read')
  }
  const der = key.export({ format: 'der', type: 'spki' })
  let verified = false
  try {
    verified = verifySignature(null, Buffer.from(sha, 'utf8'), key, Buffer.from(raw.signature, 'base64'))
  } catch {
    verified = false
  }
  return { alg: 'ed25519', key_fingerprint: createHash('sha256').update(der).digest('hex'), verified }
}

function finish(manifest: FormControlManifest, bundle: string, signatureRaw?: unknown): ParsedControlPackage {
  const problems = moduleProblems(bundle)
  if (problems.length) throw new PackageError(problems.join('; '))
  const sha256 = sha256Hex(bundle)
  const warnings: string[] = []
  if (!bundle.includes(manifest.tag)) warnings.push(`The module doesn't mention "${manifest.tag}" — it must call customElements.define('${manifest.tag}', …)`)
  if (!/ut-change/.test(bundle)) warnings.push('The module never dispatches "ut-change" — the form won\'t receive its value')
  if (manifest.accessibility?.labelled_by_host === false && !manifest.accessibility.role) warnings.push('accessibility.labelled_by_host is false and no role is declared — the accessibility checker will flag it')
  const signature = signatureRaw === undefined ? null : verifyPackageSignature(signatureRaw, sha256)
  if (signature && !signature.verified) warnings.push('signature.json does not verify against the module — recorded as unverified')
  return { manifest, bundle, sha256, size_bytes: Buffer.byteLength(bundle, 'utf8'), signature, warnings }
}

function parseManifest(raw: unknown): FormControlManifest {
  try {
    return parseFormControlManifest(raw)
  } catch (e) {
    if (e instanceof ManifestError) throw new PackageError(`manifest.json: ${e.message}`)
    throw e
  }
}

/** A module (text) plus its manifest (JSON text or object). */
export function parseModulePackage(moduleText: string, manifest: unknown, signature?: unknown): ParsedControlPackage {
  return finish(parseManifest(manifest), moduleText, signature)
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)
}

/** A zip package. */
export async function parseZipPackage(bytes: Uint8Array): Promise<ParsedControlPackage> {
  if (bytes.byteLength > PACKAGE_LIMITS.zipBytes) throw new PackageError(`The package is larger than ${PACKAGE_LIMITS.zipBytes / 1024 / 1024} MB`)
  if (!isZip(bytes)) throw new PackageError('Not a zip file')
  const PizZip = (await import('pizzip')).default
  let zip: InstanceType<typeof PizZip>
  try {
    zip = new PizZip(bytes)
  } catch {
    throw new PackageError('The zip file could not be read')
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX/') && !/(^|\/)\.[^/]+$/.test(n))
  if (names.length > 200) throw new PackageError('The package has too many files (200 at most)')
  // manifest.json at the root, or inside a single top-level folder.
  const manifestName = names.find((n) => n === 'manifest.json') ?? names.find((n) => /^[^/]+\/manifest\.json$/.test(n))
  if (!manifestName) throw new PackageError('The package has no manifest.json')
  const prefix = manifestName.slice(0, -'manifest.json'.length)
  const read = (name: string) => {
    const file = zip.file(name)
    if (!file) return null
    const text = file.asText()
    return text
  }
  const manifestText = read(manifestName) ?? ''
  if (manifestText.length > PACKAGE_LIMITS.manifestBytes) throw new PackageError('manifest.json is too large (64 KB at most)')
  const manifest = parseManifest(manifestText)
  const inside = names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length))
  const scripts = inside.filter((n) => /\.m?js$/.test(n) && !/\.map$/.test(n))
  let entry = manifest.entry
  if (entry && !inside.includes(entry)) throw new PackageError(`manifest.json entry "${entry}" is not in the package`)
  if (!entry) {
    entry = scripts.length === 1 ? scripts[0] : ['index.js', 'index.mjs', 'dist/index.js', 'dist/index.mjs', `dist/${manifest.tag}.js`, `${manifest.tag}.js`].find((n) => inside.includes(n))
  }
  if (!entry) throw new PackageError(scripts.length ? `Several scripts in the package (${scripts.slice(0, 4).join(', ')}) — set "entry" in manifest.json` : 'The package has no .js / .mjs module')
  const bundle = read(prefix + entry) ?? ''
  const signatureText = inside.includes('signature.json') ? read(`${prefix}signature.json`) : null
  let signature: unknown
  if (signatureText !== null) {
    try { signature = JSON.parse(signatureText) } catch { throw new PackageError('signature.json is not valid JSON') }
  }
  return finish({ ...manifest, entry }, bundle, signature)
}

/** Any upload: zip bytes, or a module with a separate manifest. */
export async function parseControlUpload(input: { zip?: Uint8Array | null; module?: string | null; manifest?: unknown; signature?: unknown }): Promise<ParsedControlPackage> {
  if (input.zip && input.zip.byteLength) return parseZipPackage(input.zip)
  if (typeof input.module === 'string') {
    if (input.manifest === undefined || input.manifest === null || input.manifest === '') throw new PackageError('Add the manifest.json for the module (or upload a zip with both)')
    return parseModulePackage(input.module, input.manifest, input.signature)
  }
  throw new PackageError('Upload a zip package, or a module and its manifest')
}

/** Form controls in a package that need network access: their hosts stay blocked until an admin approves them. */
export function networkControls(assets: Record<string, unknown>): Array<{ tag: string; name: string; hosts: string[] }> {
  const out: Array<{ tag: string; name: string; hosts: string[] }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- package JSON, checked field by field below
  for (const control of (Array.isArray(assets.form_controls) ? assets.form_controls : []) as any[]) {
    const versions = Array.isArray(control?.versions) ? control.versions : []
    const manifest = versions[versions.length - 1]?.manifest
    if (!Array.isArray(manifest?.capabilities) || !manifest.capabilities.includes('network')) continue
    const hosts = Array.isArray(manifest.network?.allowed_hosts) ? manifest.network.allowed_hosts.map(String) : []
    out.push({ tag: String(control.tag ?? manifest.tag ?? ''), name: String(control.name ?? manifest.name ?? ''), hosts })
  }
  return out
}
