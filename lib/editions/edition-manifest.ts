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
 * The Enterprise edition (`"edition": "enterprise"`) names a build number and
 * every extension compiled in instead of one extension version:
 *
 *   { …, "edition": "enterprise", "edition_version": "0.4.0-ent.3", "core_version": "0.4.0",
 *     "build": 3,
 *     "extensions": [ { "id": "sharepoint", "name": "SharePoint Server", "package": "@usertasks-ext/sharepoint",
 *                       "version": "0.1.0", "commit": "<sha>", "ref": "v0.1.0", "sku": "sharepoint-se" }, … ],
 *     "fingerprint": "sha256:<inputs>", "built_at": …, "index_digest": …, "platforms": … }
 *
 * A compatibility manifest of the SharePoint edition served by an Enterprise
 * build is the single-extension format plus `served_by: "enterprise"` and
 * `served_by_version` (the same digests as the Enterprise build).
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
import { editionById, isReleaseVersion, ENTERPRISE_EDITION_ID } from './catalog'

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
  /** Single-extension editions (sharepoint); not in an Enterprise manifest. */
  extension_version: version.optional(),
  extension_commit: commit,
  /** Enterprise: the build number of this core release. */
  build: z.number().int().min(0).max(999_999).optional(),
  /** Enterprise: every extension compiled in. */
  extensions: z.array(z.looseObject({
    id: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/),
    name: z.string().max(200).optional(),
    package: z.string().max(214).optional(),
    version,
    commit,
    ref: z.string().max(200).optional(),
    sku: z.string().max(100).optional(),
  })).max(50).optional(),
  fingerprint: digest.optional(),
  served_by: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/).optional(),
  served_by_version: z.string().max(130).optional(),
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
  if (m.edition === ENTERPRISE_EDITION_ID) {
    if (m.build === undefined || !m.extensions?.length) throw new EditionManifestError('edition.json: an Enterprise manifest needs build and extensions')
    if (m.edition_version !== `${m.core_version}-ent.${m.build}`) {
      throw new EditionManifestError(`edition.json: edition_version ${m.edition_version} is not build ${m.build} of core ${m.core_version}`)
    }
    if (new Set(m.extensions.map((e) => e.id)).size !== m.extensions.length) throw new EditionManifestError('edition.json: an extension is listed twice')
    return m
  }
  if (!m.extension_version) throw new EditionManifestError('edition.json: extension_version is required')
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

/** The extensions an edition build contains: the Enterprise list, or the one extension of a single-extension edition. */
export function editionManifestExtensions(m: EditionManifest): Array<{ id: string; version: string }> {
  if (m.extensions?.length) return m.extensions.map((e) => ({ id: e.id, version: e.version }))
  const def = editionById(m.edition)
  return def && m.extension_version ? def.extensions.map((e) => ({ id: e.id, version: m.extension_version! })) : []
}
