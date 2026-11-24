/**
 * Editions: UserTasks images with paid extensions compiled in (extensions are
 * built in at build time, lib/extensions/build/codegen.ts), pulled by
 * licensed customers through usertasks.com. Client-safe.
 *
 * The public image (ghcr.io/homepresso/usertasks) has no paid extension.
 *
 * UserTasks ENTERPRISE is ONE image with every paid extension compiled in
 * (SharePoint Server, Infrastructure; Processing when it is released). Each
 * extension stays locked until its own licence is installed — the licence
 * checks are the running server's (lib/licensing), so installing a licence
 * on the Enterprise edition unlocks its extension with no reinstall. The
 * image lives in a PRIVATE registry; customers never get credentials for it.
 * Instead the one-line installer and `usertasks upgrade` send their licence
 * (ANY licence for an extension the build includes) to
 * POST /api/public/extensions/enterprise/pull-token and get a short-lived
 * (30 minute), read-only credential for the usertasks.com registry front
 * (`/v2/…`, app/v2/[[...path]]/route.ts). See docs/self-hosting.md#editions.
 *
 * Enterprise versions are `<core version>-ent.<n>` (e.g. 0.4.0-ent.2): n
 * counts the builds of one core release (a new extension release rebuilds
 * the current core); the signed edition.json lists every included extension
 * and its version (lib/editions/edition-manifest.ts). Built by the private
 * usertasks-enterprise repository.
 *
 * The SharePoint edition (`--edition sharepoint`, versions
 * `<core>-sp<extension>`) was the first, single-extension edition. It stays
 * as an ALIAS: its pull-token route serves the Enterprise image (through a
 * signed compatibility manifest that the installers of SharePoint edition
 * installs already accept) once the Enterprise upstream is configured, and
 * its own legacy repository until then. Existing installs keep upgrading with
 * no change; `usertasks upgrade --edition enterprise` switches the name too.
 */

export interface EditionExtension {
  /** Extension manifest id (what a licence grants). */
  id: string
  /** Licence SKU the extension is sold as. */
  sku: string
  /** Display name. */
  name: string
}

export interface EditionDefinition {
  /** Installer flag value: `--edition <id>`. */
  id: string
  /** Display name. */
  name: string
  /**
   * Paid extensions this edition may contain: a licence granting any of them
   * may pull it (for Enterprise, only those the signed manifest of the build
   * actually lists; lib/editions/pull-service.ts).
   */
  extensions: readonly EditionExtension[]
  /** Repository on the usertasks.com registry front (never the private upstream name). */
  repository: string
  /** Marker between the core version and the rest of an edition version (`-sp1.2.0`, `-ent.3`). */
  versionMarker: string
  /**
   * A legacy edition served by another edition's image: its manifests are the
   * compatibility manifests `<id>-edition-<ref>` in that edition's upstream
   * (falling back to its own upstream while that one is not configured).
   */
  servedBy?: string
}

export const SHAREPOINT_EXTENSION: EditionExtension = { id: 'sharepoint', sku: 'sharepoint-se', name: 'SharePoint Server' }
export const INFRASTRUCTURE_EDITION_EXTENSION: EditionExtension = { id: 'infrastructure', sku: 'infrastructure', name: 'Infrastructure add-on' }
export const PROCESSING_EDITION_EXTENSION: EditionExtension = { id: 'processing', sku: 'processing-tier', name: 'Processing add-on' }

export const ENTERPRISE_EDITION_ID = 'enterprise'

export const EDITIONS: Readonly<Record<string, EditionDefinition>> = {
  enterprise: {
    id: 'enterprise',
    name: 'UserTasks Enterprise',
    extensions: [SHAREPOINT_EXTENSION, INFRASTRUCTURE_EDITION_EXTENSION, PROCESSING_EDITION_EXTENSION],
    repository: 'editions/enterprise',
    versionMarker: 'ent',
  },
  sharepoint: {
    id: 'sharepoint',
    name: 'UserTasks for SharePoint Server',
    extensions: [SHAREPOINT_EXTENSION],
    repository: 'editions/sharepoint',
    versionMarker: 'sp',
    servedBy: 'enterprise',
  },
}

export function editionById(id: unknown): EditionDefinition | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(EDITIONS, id) ? EDITIONS[id] : null
}

/** The edition to get `extensionId` from: the Enterprise edition for every paid extension it may contain. */
export function editionForExtension(extensionId: string): EditionDefinition | null {
  const all = Object.values(EDITIONS)
  return all.find((e) => !e.servedBy && e.extensions.some((x) => x.id === extensionId)) ?? all.find((e) => e.extensions.some((x) => x.id === extensionId)) ?? null
}

/** The SKU a paid extension is sold as (from the edition catalog), or null. */
export function skuForExtension(extensionId: string): string | null {
  for (const e of Object.values(EDITIONS)) {
    const x = e.extensions.find((x) => x.id === extensionId)
    if (x) return x.sku
  }
  return null
}

/**
 * Where an edition's builds are read from, in order. An edition of its own:
 * its upstream, tags `edition-<ref>`. A legacy edition served by another
 * (sharepoint → enterprise): first the serving edition's upstream, tags
 * `<id>-edition-<ref>` (the compatibility manifests the Enterprise build
 * signs), then its own upstream while that is still configured (builds made
 * before the Enterprise edition, or before EDITION_UPSTREAM_ENTERPRISE is set).
 */
export function editionSources(edition: EditionDefinition): Array<{ serving: EditionDefinition; tagPrefix: string }> {
  const serving = edition.servedBy ? editionById(edition.servedBy) : null
  return [...(serving ? [{ serving, tagPrefix: `${edition.id}-` }] : []), { serving: edition, tagPrefix: '' }]
}

/** Is this the Enterprise edition? */
export function isEnterprise(edition: EditionDefinition | null | undefined): boolean {
  return edition?.id === ENTERPRISE_EDITION_ID
}

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/

export function isReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && SEMVER.test(value)
}

/** `0.3.0` + `1.2.0` → `0.3.0-sp1.2.0` (single-extension editions); `0.4.0` + `3` → `0.4.0-ent.3` (Enterprise). */
export function editionVersion(edition: EditionDefinition, coreVersion: string, extensionVersionOrBuild: string | number): string {
  if (isEnterprise(edition)) return `${coreVersion}-${edition.versionMarker}.${extensionVersionOrBuild}`
  return `${coreVersion}-${edition.versionMarker}${extensionVersionOrBuild}`
}

/** `0.3.0-sp1.2.0` → { core: 0.3.0, extension: 1.2.0 }; null when it isn't one. Not for Enterprise (parseEnterpriseVersion). */
export function parseEditionVersion(edition: EditionDefinition, value: string): { core: string; extension: string } | null {
  if (isEnterprise(edition)) return null
  const marker = `-${edition.versionMarker}`
  const at = value.lastIndexOf(marker)
  if (at <= 0) return null
  const core = value.slice(0, at)
  const extension = value.slice(at + marker.length)
  return isReleaseVersion(core) && isReleaseVersion(extension) ? { core, extension } : null
}

/** `0.4.0-ent.3` → { core: 0.4.0, build: 3 }; null when it isn't one. */
export function parseEnterpriseVersion(value: string): { core: string; build: number } | null {
  const m = /^(.+)-ent\.(0|[1-9][0-9]{0,5})$/.exec(value)
  if (!m || !isReleaseVersion(m[1])) return null
  return { core: m[1], build: Number(m[2]) }
}

/** Is `value` one exact build of this edition (as opposed to a core version)? */
export function isEditionBuildVersion(edition: EditionDefinition, value: string): boolean {
  return isEnterprise(edition) ? parseEnterpriseVersion(value) !== null : parseEditionVersion(edition, value) !== null
}

// ─── Commands shown to people (Settings → Extensions, docs, get-started) ──

export const INSTALL_SH_URL = 'https://usertasks.com/install.sh'
export const INSTALL_PS1_URL = 'https://usertasks.com/install.ps1'

/**
 * One-line install of an edition (Linux / macOS). With a licence and no
 * --edition the installers pick the Enterprise edition anyway; the flag
 * makes it explicit.
 */
export function editionInstallSh(edition: EditionDefinition, licencePath = 'usertasks.licence'): string {
  return `curl -fsSL ${INSTALL_SH_URL} | sh -s -- --edition ${edition.id} --licence ${licencePath}`
}

/** One-line install of an edition (Windows PowerShell). */
export function editionInstallPs1(edition: EditionDefinition, licencePath = '.\\usertasks.licence'): string {
  return `& ([scriptblock]::Create((irm ${INSTALL_PS1_URL}))) -Edition ${edition.id} -Licence ${licencePath}`
}

/**
 * Switch an existing one-line install to an edition, keeping its data: the
 * same database, files and .env, a backup first, the edition image of the
 * installed version (or newer). The licence installed in UserTasks is used
 * when --licence is left out.
 */
export function editionSwitchSh(edition: EditionDefinition): string {
  return `usertasks upgrade --edition ${edition.id}`
}

export function editionSwitchPs1(edition: EditionDefinition): string {
  return `usertasks upgrade -Edition ${edition.id}`
}

/** Air-gapped: on a connected machine, then on the offline host. */
export function editionBundleDownloadSh(edition: EditionDefinition, licencePath = 'usertasks.licence'): string {
  return `curl -fsSL ${INSTALL_SH_URL} | sh -s -- --bundle-download --edition ${edition.id} --licence ${licencePath}`
}

export function editionBundleInstallSh(file = 'usertasks-edition-enterprise-<version>-linux-amd64.tar'): string {
  return `sh install.sh --bundle ${file}`
}
