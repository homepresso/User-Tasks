/**
 * The edition manifest (`edition.json`): what an edition build is, signed with
 * the UserTasks release key (ed25519 over the file's exact bytes, like
 * SHA256SUMS.sig; deploy/install/release-key.pub.pem).
 *
 *   {
 *     "format": 1, "kind": "usertasks.edition", "edition": "sharepoint",
 *     "edition_version": "0.3.0-sp1.2.0",
 *     "core_version": "0.3.0", "core_commit": "<sha>",
 *     "extension_version": "1.2.0", "extension_commit": "<sha>",
 *     "built_at": "2026-11-16T00:00:00Z",
 *     "index_digest": "sha256:<multi-arch index>",
 *     "platforms": {
 *       "linux/amd64": { "manifest": "sha256:…", "config": "sha256:…" },
 *       "linux/arm64": { "manifest": "sha256:…", "config": "sha256:…" }
 *     }
 *   }
 *
 * The installers verify the signature with the release key they already
 * trust, pull the image BY `index_digest` (so the registry can only hand over
 * exactly these bytes), and check the image they end up with is one of the
 * signed digests (its config digest on Docker's classic image store, the
 * index / platform manifest digest on the containerd store). The offline
 * bundle is checked the same way after `docker load`.
 *
 * Top-level keys are unique on purpose: the POSIX shell installers read them
 * with sed, without a JSON parser.
 *
 * The build writes it (the private edition workflow); the pull-token endpoint
 * passes it through unchanged, with its signature.
 */

import { createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import { editionById, isReleaseVersion } from './catalog'

export const EDITION_MANIFEST_KIND = 'usertasks.edition'
export const EDITION_MANIFEST_FORMAT = 1

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'a sha256 digest')
const version = z.string().refine(isReleaseVersion, 'a release version')
const commit = z.string().regex(/^[0-9a-f]{7,64}$/).optional()

export const EditionManifestSchema = z.looseObject({
  format: z.literal(EDITION_MANIFEST_FORMAT),
  kind: z.literal(EDITION_MANIFEST_KIND),
  edition: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
  edition_version: z.string().min(5).max(130),
  core_version: version,
  core_commit: commit,
  extension_version: version,
  extension_commit: commit,
  built_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'a date'),
  index_digest: digest,
  platforms: z.record(z.string().regex(/^linux\/(amd64|arm64)$/), z.looseObject({ manifest: digest, config: digest })).refine((p) => Object.keys(p).length > 0, 'at least one platform'),
})

export type EditionManifest = z.infer<typeof EditionManifestSchema>

export class EditionManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditionManifestError'
  }
}

/** Parse and shape-check edition.json bytes (no signature check). */
export function parseEditionManifest(bytes: Uint8Array | string): EditionManifest {
  let value: unknown
  try {
    value = JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new EditionManifestError('edition.json is not JSON')
  }
  const parsed = EditionManifestSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new EditionManifestError(`edition.json: ${issue?.path.join('.') || 'document'}: ${issue?.message ?? 'invalid'}`)
  }
  const m = parsed.data
  const marker = editionById(m.edition)?.versionMarker ?? m.edition
  if (m.edition_version !== `${m.core_version}-${marker}${m.extension_version}`) {
    throw new EditionManifestError(`edition.json: edition_version ${m.edition_version} does not pair core ${m.core_version} with extension ${m.extension_version}`)
  }
  return m
}

/** Ed25519 signature over the exact bytes, with a PEM (SPKI) public key. */
export function verifyEditionSignature(bytes: Uint8Array, signature: Uint8Array, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem)
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, Buffer.from(bytes), key, Buffer.from(signature))
  } catch {
    return false
  }
}

/** Every digest the manifest vouches for (what a pulled or loaded image may be identified by). */
export function editionDigests(m: EditionManifest): string[] {
  const out = new Set<string>([m.index_digest])
  for (const p of Object.values(m.platforms)) {
    out.add(p.manifest)
    out.add(p.config)
  }
  return [...out]
}
