/**
 * Package file format (.utpkg): container, canonical JSON, checksum and
 * ed25519 signature. Dependency-free apart from node:crypto and ./zip, so
 * packages/cli/src/package-format.ts is a copy (only the ./zip import differs; offline
 * `usertasks packages inspect`); __tests__/packages-format checks the copies.
 *
 * A .utpkg is a ZIP archive:
 *
 *   manifest.json            header: package, data modes, requirements,
 *                            dependencies, files index (sha256 per file),
 *                            checksum, signature
 *   README.md                the package readme
 *   assets/manifest.json     GitHub-sync layout (lib/github-sync/layout.ts):
 *   assets/<dir>/<slug>-<shortid>.json   one envelope per asset
 *   data/<slug>-<shortid>.ndjson         data-table rows (mode "rows" only)
 *
 * Integrity chain: signature → checksum → manifest.json (canonical JSON
 * without `checksum` and `signature`, which includes every file's sha256) →
 * each file. Any edit to any file, or to the header, breaks the checksum;
 * re-signing needs the private key.
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { readZip, writeZip, type ZipEntry } from './zip'

export const PACKAGE_FORMAT_VERSION = 1
export const PACKAGE_KIND = 'usertasks.package'
export const PACKAGE_EXTENSION = '.utpkg'
export const PACKAGE_MANIFEST_FILE = 'manifest.json'
export const PACKAGE_README_FILE = 'README.md'
export const PACKAGE_ASSETS_PREFIX = 'assets'
export const PACKAGE_DATA_PREFIX = 'data'

export interface PackageHeader {
  /** Stable package id (uuid): the same package in every environment. */
  id: string
  name: string
  slug: string
  /** Semantic version, e.g. 1.2.0. */
  version: string
  description: string | null
  author: string | null
  created_at: string
  icon?: string | null
  readme: string | null
}

export type RequirementKind = 'connector' | 'integration_auth' | 'secret' | 'email_template' | 'role' | 'user' | 'env'
export type RequirementFieldType = 'string' | 'password' | 'url' | 'number' | 'boolean' | 'text' | 'user'

export interface RequirementField {
  key: string
  label: string
  type: RequirementFieldType
  secret: boolean
  default?: unknown
  description?: string
  /** Where the value goes: a path inside the asset (in the package's assets). */
  target: { section: string; asset_id: string; path: Array<string | number> }
}

export interface PackageRequirement {
  /** Stable within the package: `<kind>:<section>:<asset id>[:<suffix>]`. */
  id: string
  kind: RequirementKind
  ref: { section: string; asset_id: string; name: string }
  label: string
  description: string
  required: boolean
  fields: RequirementField[]
}

export interface PackageDependency {
  package_slug: string
  version_range: string
}

export interface PackageDataEntry {
  mode: 'schema' | 'rows'
  /** Path of the NDJSON rows file (mode rows). */
  rows_file?: string
  row_count?: number
}

export interface PackageFileIndexEntry {
  path: string
  sha256: string
  size: number
}

export interface PackageSignature {
  alg: 'ed25519'
  /** SPKI DER public key, base64. */
  public_key: string
  /** sha256 of the public key, colon-separated hex pairs (first 16 bytes). */
  fingerprint: string
  /** Signature over the UTF-8 checksum string, base64. */
  value: string
}

/** manifest.json inside the archive. */
export interface PackageFileManifest {
  format_version: number
  kind: string
  package: PackageHeader
  data: Record<string, PackageDataEntry>
  requirements: PackageRequirement[]
  dependencies: PackageDependency[]
  files: PackageFileIndexEntry[]
  checksum: string
  signature?: PackageSignature
}

// ─── Canonical JSON + hashing ───────────────────────────────────────────────

/** JSON with object keys sorted at every depth and no whitespace; undefined members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex')
}

/** `sha256:<hex>` over the canonical manifest without `checksum` and `signature`. */
export function computeChecksum(manifest: Omit<PackageFileManifest, 'checksum' | 'signature'> & { checksum?: string; signature?: unknown }): string {
  const { checksum: _checksum, signature: _signature, ...rest } = manifest
  return `sha256:${sha256Hex(canonicalJson(rest))}`
}

// ─── Signing ────────────────────────────────────────────────────────────────

export function keyFingerprint(publicKeyBase64: string): string {
  const digest = createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 32)
  return digest.match(/../g)!.join(':')
}

export function publicKeyBase64(key: KeyObject): string {
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64')
}

export function signChecksum(checksum: string, privateKeyPem: string): PackageSignature {
  const privateKey = createPrivateKey(privateKeyPem)
  const publicKey = publicKeyBase64(privateKey)
  return {
    alg: 'ed25519',
    public_key: publicKey,
    fingerprint: keyFingerprint(publicKey),
    value: sign(null, Buffer.from(checksum, 'utf8'), privateKey).toString('base64'),
  }
}

export function verifySignature(checksum: string, signature: PackageSignature): boolean {
  try {
    if (signature.alg !== 'ed25519') return false
    const key = createPublicKey({ key: Buffer.from(signature.public_key, 'base64'), format: 'der', type: 'spki' })
    if (keyFingerprint(signature.public_key) !== signature.fingerprint) return false
    return verify(null, Buffer.from(checksum, 'utf8'), key, Buffer.from(signature.value, 'base64'))
  } catch {
    return false
  }
}

// ─── Pack / unpack ──────────────────────────────────────────────────────────

export interface PackInput {
  header: Omit<PackageFileManifest, 'files' | 'checksum' | 'signature'>
  /** Every file except manifest.json. */
  files: Array<{ path: string; content: string }>
  /** PEM private key (ed25519); unsigned when omitted. */
  signingKeyPem?: string | null
}

export interface PackResult {
  bytes: Uint8Array
  manifest: PackageFileManifest
  files: Array<{ path: string; content: string }>
}

/** Build the archive: files index, checksum, optional signature, ZIP. */
export function packPackage(input: PackInput): PackResult {
  const files = [...input.files].sort((a, b) => a.path.localeCompare(b.path))
  const seen = new Set<string>()
  for (const file of files) {
    if (file.path === PACKAGE_MANIFEST_FILE) throw new Error('manifest.json is generated')
    if (seen.has(file.path)) throw new Error(`Duplicate file ${file.path}`)
    seen.add(file.path)
  }
  const index: PackageFileIndexEntry[] = files.map((file) => {
    const bytes = Buffer.from(file.content, 'utf8')
    return { path: file.path, sha256: sha256Hex(bytes), size: bytes.length }
  })
  const unsigned = { ...input.header, files: index }
  const checksum = computeChecksum(unsigned)
  const manifest: PackageFileManifest = { ...unsigned, checksum }
  if (input.signingKeyPem) manifest.signature = signChecksum(checksum, input.signingKeyPem)
  return { bytes: archivePackage(manifest, files), manifest, files }
}

/** The archive bytes for a built manifest and its files (deterministic: same input, same bytes). */
export function archivePackage(manifest: PackageFileManifest, files: Array<{ path: string; content: string }>): Uint8Array {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const entries: ZipEntry[] = [
    { path: PACKAGE_MANIFEST_FILE, data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') },
    ...sorted.map((file) => ({ path: file.path, data: Buffer.from(file.content, 'utf8') })),
  ]
  return writeZip(entries)
}

export interface PackageVerification {
  /** Header checksum matches the recomputed one and every file matches its hash. */
  valid: boolean
  checksum: string | null
  checksum_ok: boolean
  files_ok: boolean
  signed: boolean
  signature_ok: boolean | null
  fingerprint: string | null
  errors: string[]
}

export interface UnpackResult {
  manifest: PackageFileManifest
  files: Array<{ path: string; content: string }>
  verification: PackageVerification
}

/**
 * Read and verify an archive. Never throws for integrity failures (they are
 * reported in `verification`); throws only when the bytes are not a package.
 */
export function unpackPackage(bytes: Uint8Array): UnpackResult {
  const entries = readZip(bytes)
  const byPath = new Map(entries.map((entry) => [entry.path, entry.data]))
  const rawManifest = byPath.get(PACKAGE_MANIFEST_FILE)
  if (!rawManifest) throw new Error('Not a UserTasks package: manifest.json is missing')
  let manifest: PackageFileManifest
  try {
    manifest = JSON.parse(Buffer.from(rawManifest).toString('utf8'))
  } catch (error) {
    throw new Error(`Not a UserTasks package: manifest.json is not valid JSON (${(error as Error).message})`)
  }
  if (!manifest || typeof manifest !== 'object' || manifest.kind !== PACKAGE_KIND) {
    throw new Error(`Not a UserTasks package: manifest.json kind must be "${PACKAGE_KIND}"`)
  }
  if (typeof manifest.format_version !== 'number' || manifest.format_version > PACKAGE_FORMAT_VERSION) {
    throw new Error(`Unsupported package format_version ${String(manifest.format_version)} (this server reads up to ${PACKAGE_FORMAT_VERSION})`)
  }
  return { manifest, ...verifyFiles(manifest, byPath) }
}

function verifyFiles(manifest: PackageFileManifest, byPath: Map<string, Uint8Array>): { files: UnpackResult['files']; verification: PackageVerification } {
  const errors: string[] = []
  const files: UnpackResult['files'] = []
  const index = Array.isArray(manifest.files) ? manifest.files : []
  const listed = new Set(index.map((entry) => entry.path))
  let filesOk = true
  for (const entry of index) {
    const data = byPath.get(entry.path)
    if (!data) { filesOk = false; errors.push(`Missing file ${entry.path}`); continue }
    if (sha256Hex(data) !== entry.sha256) { filesOk = false; errors.push(`File ${entry.path} was modified (sha256 mismatch)`) }
    files.push({ path: entry.path, content: Buffer.from(data).toString('utf8') })
  }
  for (const path of byPath.keys()) {
    if (path !== PACKAGE_MANIFEST_FILE && !listed.has(path)) { filesOk = false; errors.push(`Unlisted file ${path}`) }
  }
  const recomputed = computeChecksum(manifest)
  const checksumOk = typeof manifest.checksum === 'string' && manifest.checksum === recomputed
  if (!checksumOk) errors.push('Checksum mismatch: the package was modified after it was built')
  const signed = Boolean(manifest.signature)
  const signatureOk = signed ? checksumOk && verifySignature(String(manifest.checksum), manifest.signature!) : null
  if (signed && !signatureOk) errors.push('Signature is invalid')
  return {
    files,
    verification: {
      valid: checksumOk && filesOk && signatureOk !== false,
      checksum: typeof manifest.checksum === 'string' ? manifest.checksum : null,
      checksum_ok: checksumOk,
      files_ok: filesOk,
      signed,
      signature_ok: signatureOk,
      fingerprint: manifest.signature?.fingerprint ?? null,
      errors,
    },
  }
}
