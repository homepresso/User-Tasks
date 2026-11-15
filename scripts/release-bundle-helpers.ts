/**
 * Pure helpers of `npm run release:bundle` (scripts/release-bundle.ts): the
 * one-line installer's release bundle, its manifest, SHA256SUMS, the ed25519
 * signature, the installers' embedded release key and the release notes.
 * Separate so tests can import them without running the CLI.
 */
import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { fingerprintOf } from './bundle'

/** The published image the bundle pins (.github/workflows/image.yml). */
export const RELEASE_IMAGE_REPO = 'ghcr.io/homepresso/usertasks'

/** Files of deploy/install/ and the repository copied into the bundle: [source, name in the bundle, executable]. */
export const BUNDLE_FILES: ReadonlyArray<readonly [string, string, boolean]> = [
  ['docker-compose.yml', 'docker-compose.yml', false],
  ['deploy/compose/standalone.env.example', 'env.template', false],
  ['deploy/install/usertasks', 'usertasks', true],
  ['deploy/install/usertasks.ps1', 'usertasks.ps1', false],
  ['deploy/install/usertasks.cmd', 'usertasks.cmd', false],
  ['LICENSE', 'LICENSE', false],
  ['NOTICE', 'NOTICE', false],
]

/** Release assets next to the bundle (the installers are attached as they are). */
export const INSTALLER_FILES = ['install.sh', 'install.ps1'] as const

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

export function assertVersion(version: string): string {
  const v = version.replace(/^v/, '')
  if (!VERSION_RE.test(v)) throw new Error(`not a release version: ${version} (expected x.y.z or x.y.z-pre)`)
  return v
}

export function bundleName(version: string): string {
  return `usertasks-${assertVersion(version)}.tar.gz`
}

export interface ReleaseManifest {
  schema: 1
  version: string
  image: string
  imageDigest?: string
  createdAt: string
  gitCommit?: string
  migrations: { count: number; latest: string | null }
  /** Oldest version `usertasks upgrade` may start from (null: any). */
  minimumUpgradeFrom: string | null
}

export function buildManifest(input: {
  version: string
  image?: string
  imageDigest?: string
  gitCommit?: string
  migrations: string[]
  createdAt?: Date
  minimumUpgradeFrom?: string | null
}): ReleaseManifest {
  const version = assertVersion(input.version)
  if (input.imageDigest && !DIGEST_RE.test(input.imageDigest)) throw new Error(`image digest must be sha256:<64 hex>, got ${input.imageDigest}`)
  const image = input.image ?? `${RELEASE_IMAGE_REPO}:${version}`
  if (/\s|"/.test(image)) throw new Error(`invalid image reference: ${image}`)
  const sql = input.migrations.filter((m) => m.endsWith('.sql')).sort()
  return {
    schema: 1,
    version,
    image,
    ...(input.imageDigest ? { imageDigest: input.imageDigest } : {}),
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    ...(input.gitCommit ? { gitCommit: input.gitCommit } : {}),
    migrations: { count: sql.length, latest: sql.length ? sql[sql.length - 1].replace(/\.sql$/, '') : null },
    minimumUpgradeFrom: input.minimumUpgradeFrom ?? null,
  }
}

/**
 * The manifest as the shell wrapper reads it: one `"key": "value"` per line
 * (the wrapper greps it, it has no JSON parser).
 */
export function manifestJson(m: ReleaseManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`
}

/** release.json: what `latest/download/release.json` answers (version discovery only; never trusted for integrity). */
export function releaseJson(m: ReleaseManifest): string {
  return `${JSON.stringify({ version: m.version, image: m.image, imageDigest: m.imageDigest ?? null, bundle: bundleName(m.version) }, null, 2)}\n`
}

/** SHA256SUMS (sha256sum format, sorted by name). */
export function sumsText(entries: Record<string, string>): string {
  return `${Object.keys(entries).sort().map((name) => {
    if (!/^[0-9a-f]{64}$/.test(entries[name])) throw new Error(`bad sha256 for ${name}`)
    if (/[\s/\\]/.test(name)) throw new Error(`asset names are plain file names: ${name}`)
    return `${entries[name]}  ${name}`
  }).join('\n')}\n`
}

export function parseSums(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line)
    if (!m) throw new Error(`malformed SHA256SUMS line: ${line}`)
    out[m[2]] = m[1]
  }
  return out
}

export function signSums(sums: string, privateKey: KeyObject): Buffer {
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('the release signing key must be an ed25519 private key (PEM)')
  return sign(null, Buffer.from(sums), privateKey)
}

export function verifySums(sums: string | Buffer, signature: Buffer, publicKey: KeyObject): boolean {
  return verify(null, Buffer.isBuffer(sums) ? sums : Buffer.from(sums), publicKey, signature)
}

export function publicKeyPem(key: KeyObject): string {
  return (key.type === 'public' ? key : createPublicKey(key)).export({ type: 'spki', format: 'pem' }).toString()
}

export { fingerprintOf }

// ── the installers' embedded release key ────────────────────────────────────

const SH_KEY_RE = /(USERTASKS_RELEASE_PUBLIC_KEY=')([\s\S]*?)(')/
const PS_KEY_RE = /(\$ReleasePublicKey = @')([\s\S]*?)('@)/

/** The PEM embedded in install.sh / install.ps1 ('' while none is set). */
export function embeddedKey(script: string): string {
  const m = SH_KEY_RE.exec(script) ?? PS_KEY_RE.exec(script)
  if (!m) throw new Error('no embedded release key block found')
  const pem = m[2].trim()
  return /-----BEGIN PUBLIC KEY-----\s*\S+[\s\S]*-----END PUBLIC KEY-----/.test(pem) ? `${pem}\n` : ''
}

/** The script with `pem` as its embedded release key. */
export function withEmbeddedKey(script: string, pem: string): string {
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('the release key must be an ed25519 public key')
  const clean = publicKeyPem(key).trim()
  if (SH_KEY_RE.test(script)) return script.replace(SH_KEY_RE, (_m, a: string, _b: string, c: string) => `${a}\n${clean}\n${c}`)
  if (PS_KEY_RE.test(script)) return script.replace(PS_KEY_RE, (_m, a: string, _b: string, c: string) => `${a}\n${clean}\n${c}`)
  throw new Error('no embedded release key block found')
}

// ── release notes ───────────────────────────────────────────────────────────

/** {{name}} placeholders; an unknown one is an error (a typo would otherwise ship). */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, name: string) => {
    if (!(name in values)) throw new Error(`release notes template: unknown placeholder {{${name}}}`)
    return values[name]
  })
}

export function newMigrations(all: string[], previous: string[]): string[] {
  const before = new Set(previous)
  return all.filter((m) => m.endsWith('.sql') && !before.has(m)).sort()
}

export function releaseNotesValues(input: {
  manifest: ReleaseManifest
  fingerprint: string
  previousVersion?: string
  newMigrations?: string[]
  repository?: string
}): Record<string, string> {
  const m = input.manifest
  const repo = input.repository ?? 'https://github.com/homepresso/User-Tasks'
  const list = input.newMigrations ?? []
  return {
    version: m.version,
    image: m.image,
    image_ref: m.imageDigest ? `${m.image}@${m.imageDigest}` : m.image,
    digest: m.imageDigest ?? '(not pinned)',
    fingerprint: input.fingerprint,
    previous: input.previousVersion ?? '(first release)',
    migrations_count: String(list.length),
    migrations: list.length ? list.map((f) => `- \`${f}\``).join('\n') : '- None',
    bundle: bundleName(m.version),
    repository: repo,
  }
}
