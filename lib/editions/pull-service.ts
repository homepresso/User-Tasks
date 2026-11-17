/**
 * POST /api/public/extensions/<edition>/pull-token: a licence in, a
 * 30-minute read-only registry credential for that one edition out.
 *
 * Request (JSON, ≤ 64 KB):
 *   { "licence": "<the .licence file: JSON text, base64 of it, or the object>",
 *     "version": "latest" | "<core x.y.z>" | "<edition x.y.z-spa.b.c>",   (default latest)
 *     "purpose": "install" | "upgrade" | "bundle" | "switch",             (informational)
 *     "instance_id": "inst_…" }                                          (informational)
 *
 * Response 200 — flat on purpose (the POSIX installers read it with sed):
 *   { "registry": "usertasks.com", "repository": "editions/sharepoint",
 *     "username": "licence", "password": "<pull token>", "expires_at": "…",
 *     "image": "usertasks.com/editions/sharepoint@sha256:…",
 *     "edition_version": "0.3.0-sp1.2.0", "core_version": "0.3.0", "extension_version": "1.2.0",
 *     "index_digest": "sha256:…",
 *     "edition_manifest": "<base64 of edition.json>", "edition_signature": "<base64 of edition.json.sig>",
 *     "licence_id": "…", "trial": false, "licence_expires_at": "…", "licence_cutoff_at": "…" }
 *
 * Errors: { error, code } with 400 (validation), 403 (licence_* codes),
 * 404 (edition_not_found, with `latest_core_version` when known), 429, 502
 * (upstream), 503 (editions_unavailable). The installers print `error`.
 *
 * Rate limits live in the route; this module is pure apart from its deps.
 */

import type { LicenceKey } from '@/lib/licensing/keyring'
import { isReleaseVersion, parseEditionVersion, type EditionDefinition } from './catalog'
import { EditionManifestError, parseEditionManifest, type EditionManifest } from './edition-manifest'
import { checkLicenceForEdition } from './licence-gate'
import { mintPullToken } from './pull-token'
import type { PullLogEntry } from './access-log'

export const PULL_TOKEN_USERNAME = 'licence'
export const EDITION_MANIFEST_FILE = 'edition.json'
export const EDITION_SIGNATURE_FILE = 'edition.json.sig'

export interface EditionRelease {
  manifest: Buffer
  signature: Buffer
}

export interface PullServiceDeps {
  now: () => Date
  keyring: () => readonly LicenceKey[]
  /** null: not configured (503) — `missing` lists what. */
  config: () => { ok: true; secret: string; registryHost: string; revoked: string[] } | { ok: false; missing: string[] }
  /** The signed edition files under tag `edition-<ref>`; null when there is no such tag. */
  readRelease: (ref: string) => Promise<EditionRelease | null>
  log: (entry: PullLogEntry) => Promise<void>
}

export interface PullRequestContext {
  ipHash: string | null
  userAgent: string | null
}

export interface PullOutcome {
  status: number
  body: Record<string, unknown>
}

const PURPOSES = new Set(['install', 'upgrade', 'bundle', 'switch'])

/** The artifact tag for a requested version. */
export function releaseTagFor(edition: EditionDefinition, version: string): string | null {
  if (version === 'latest') return 'edition-latest'
  // A core version (its newest edition build), or one exact edition version
  // (x.y.z-spa.b.c, which also reads as a semver pre-release).
  if (isReleaseVersion(version) || parseEditionVersion(edition, version)) return `edition-${version}`
  return null
}

export async function issuePullToken(edition: EditionDefinition, body: Record<string, unknown>, ctx: PullRequestContext, deps: PullServiceDeps): Promise<PullOutcome> {
  const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim().replace(/^v/, '') : 'latest'
  const purpose = typeof body.purpose === 'string' && PURPOSES.has(body.purpose) ? body.purpose : null
  const instanceId = typeof body.instance_id === 'string' && /^inst_[a-z0-9]{20,40}$/.test(body.instance_id) ? body.instance_id : null
  const base: PullLogEntry = { edition: edition.id, outcome: 'denied', purpose, requested_version: version.slice(0, 64), ip_hash: ctx.ipHash, user_agent: ctx.userAgent, instance_id: instanceId }

  const tag = releaseTagFor(edition, version)
  if (!tag) return { status: 400, body: { error: `Not a version: ${version.slice(0, 40)} (use latest, a UserTasks version such as 0.3.0, or an edition version)`, code: 'validation_error' } }
  const raw = body.licence
  if (raw === undefined || raw === null || raw === '') return { status: 400, body: { error: 'Send the licence (the .licence file) as "licence".', code: 'validation_error' } }
  if (typeof raw === 'string' ? raw.length > 60_000 : typeof raw !== 'object') return { status: 400, body: { error: 'The licence could not be read', code: 'validation_error' } }

  const config = deps.config()
  if (!config.ok) {
    console.warn(`[editions] ${edition.id} downloads not configured: ${config.missing.join(', ')}`)
    return { status: 503, body: { error: `${edition.name} downloads aren't available right now. Please try again later, or contact us.`, code: 'editions_unavailable' } }
  }

  const now = deps.now()
  const gate = checkLicenceForEdition({ raw, edition, now, keyring: deps.keyring(), revoked: config.revoked })
  if (!gate.ok) {
    await deps.log({ ...base, code: gate.code, licence_id: gate.licenceId ?? null })
    return { status: gate.code === 'licence_malformed' ? 400 : 403, body: { error: gate.message, code: gate.code, ...(gate.timing?.expiresAt ? { licence_expires_at: gate.timing.expiresAt } : {}) } }
  }
  const licenceId = gate.licence.licence_id
  const logged: PullLogEntry = { ...base, licence_id: licenceId, trial: gate.trial }

  let release: EditionRelease | null
  try {
    release = await deps.readRelease(tag)
  } catch (error) {
    console.error(`[editions] ${edition.id} ${tag}: ${(error as Error).message}`)
    await deps.log({ ...logged, outcome: 'error', code: 'upstream' })
    return { status: 502, body: { error: 'The edition registry could not be reached. Please try again in a few minutes.', code: 'upstream_error' } }
  }
  if (!release) {
    let latestCore: string | null = null
    if (tag !== 'edition-latest') {
      try {
        const latest = await deps.readRelease('edition-latest')
        if (latest) latestCore = parseEditionManifest(latest.manifest).core_version
      } catch { /* best effort */ }
    }
    await deps.log({ ...logged, outcome: 'not_found', code: 'edition_not_found' })
    return {
      status: 404,
      body: {
        error: tag === 'edition-latest'
          ? `No ${edition.name} build has been published yet.`
          : `There is no ${edition.name} build for UserTasks ${version} yet${latestCore ? ` (the newest is for ${latestCore})` : ''}. Builds follow each UserTasks release within a few hours.`,
        code: 'edition_not_found',
        ...(latestCore ? { latest_core_version: latestCore } : {}),
      },
    }
  }

  let manifest: EditionManifest
  try {
    manifest = parseEditionManifest(release.manifest)
    if (manifest.edition !== edition.id) throw new EditionManifestError(`edition.json is for ${manifest.edition}`)
    if (tag !== 'edition-latest' && version !== manifest.core_version && version !== manifest.edition_version) throw new EditionManifestError(`edition.json is for ${manifest.edition_version}, not ${version}`)
    if (!release.signature.length || release.signature.length > 512) throw new EditionManifestError('edition.json.sig is missing')
  } catch (error) {
    console.error(`[editions] ${edition.id} ${tag}: ${(error as Error).message}`)
    await deps.log({ ...logged, outcome: 'error', code: 'bad_edition_manifest' })
    return { status: 502, body: { error: 'The edition build is not readable. Please try again later, or contact us.', code: 'upstream_error' } }
  }

  const { token, payload } = mintPullToken({ edition: edition.id, licenceId, trial: gate.trial, now }, config.secret)
  const expiresAt = new Date(payload.exp * 1000).toISOString()
  await deps.log({ ...logged, outcome: 'issued', code: null, edition_version: manifest.edition_version, token_id: payload.jti, token_expires_at: expiresAt })
  return {
    status: 200,
    body: {
      registry: config.registryHost,
      repository: edition.repository,
      username: PULL_TOKEN_USERNAME,
      password: token,
      expires_at: expiresAt,
      image: `${config.registryHost}/${edition.repository}@${manifest.index_digest}`,
      edition: edition.id,
      edition_version: manifest.edition_version,
      core_version: manifest.core_version,
      extension_version: manifest.extension_version,
      index_digest: manifest.index_digest,
      edition_manifest: release.manifest.toString('base64'),
      edition_signature: release.signature.toString('base64'),
      licence_id: licenceId,
      trial: gate.trial,
      licence_expires_at: gate.timing.expiresAt,
      licence_cutoff_at: gate.timing.cutoffAt,
    },
  }
}

const latestCache = new Map<string, { at: number; value: Record<string, unknown> }>()
export const LATEST_CACHE_MS = 5 * 60_000

/** The newest edition build's versions (GET /api/public/extensions/<edition>); cached. */
export async function latestEditionInfo(edition: EditionDefinition, deps: Pick<PullServiceDeps, 'config' | 'readRelease' | 'now'>): Promise<Record<string, unknown>> {
  const base = { edition: edition.id, name: edition.name }
  const hit = latestCache.get(edition.id)
  const nowMs = deps.now().getTime()
  if (hit && nowMs - hit.at < LATEST_CACHE_MS) return hit.value
  let value: Record<string, unknown>
  if (!deps.config().ok) value = { ...base, available: false }
  else {
    try {
      const release = await deps.readRelease('edition-latest')
      const m = release ? parseEditionManifest(release.manifest) : null
      value = m ? { ...base, available: true, latest_core_version: m.core_version, latest_edition_version: m.edition_version } : { ...base, available: false }
    } catch (error) {
      console.error(`[editions] ${edition.id} latest: ${(error as Error).message}`)
      return { ...base, available: false }
    }
  }
  latestCache.set(edition.id, { at: nowMs, value })
  return value
}

/** Test hook. */
export function clearLatestEditionCache(): void {
  latestCache.clear()
}
