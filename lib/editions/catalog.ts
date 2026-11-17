/**
 * Editions: UserTasks images with paid extensions compiled in (extensions are
 * built in at build time, lib/extensions/build/codegen.ts), pulled by
 * licensed customers through usertasks.com. Client-safe.
 *
 * The public image (ghcr.io/homepresso/usertasks) has no paid extension. An
 * edition image lives in a PRIVATE registry; customers never get credentials
 * for it. Instead the one-line installer and `usertasks upgrade` send their
 * licence to POST /api/public/extensions/<edition>/pull-token and get a
 * short-lived (30 minute), read-only credential for the usertasks.com
 * registry front (`/v2/…`, app/v2/[[...path]]/route.ts), which serves only
 * that edition's repository. See docs/self-hosting.md#editions.
 *
 * Edition versions pair a core release with an extension release:
 * `<core version>-sp<extension version>` (e.g. 0.3.0-sp1.2.0). Each core
 * release gets an edition build; a new extension release rebuilds the
 * current core.
 */

export interface EditionDefinition {
  /** Installer flag value: `--edition <id>`. */
  id: string
  /** Display name. */
  name: string
  /** Licence SKU a licence must be for (when it names one). */
  sku: string
  /** The extension the licence must grant. */
  extensionId: string
  /** Repository on the usertasks.com registry front (never the private upstream name). */
  repository: string
  /** Tag suffix marker between the core and extension versions. */
  versionMarker: string
}

export const EDITIONS: Readonly<Record<string, EditionDefinition>> = {
  sharepoint: {
    id: 'sharepoint',
    name: 'UserTasks for SharePoint Server',
    sku: 'sharepoint-se',
    extensionId: 'sharepoint',
    repository: 'editions/sharepoint',
    versionMarker: 'sp',
  },
}

export function editionById(id: unknown): EditionDefinition | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(EDITIONS, id) ? EDITIONS[id] : null
}

/** The edition whose extension is `extensionId`, if any. */
export function editionForExtension(extensionId: string): EditionDefinition | null {
  return Object.values(EDITIONS).find((e) => e.extensionId === extensionId) ?? null
}

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/

export function isReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && SEMVER.test(value)
}

/** `0.3.0` + `1.2.0` → `0.3.0-sp1.2.0`. */
export function editionVersion(edition: EditionDefinition, coreVersion: string, extensionVersion: string): string {
  return `${coreVersion}-${edition.versionMarker}${extensionVersion}`
}

/** `0.3.0-sp1.2.0` → { core: 0.3.0, extension: 1.2.0 }; null when it isn't one. */
export function parseEditionVersion(edition: EditionDefinition, value: string): { core: string; extension: string } | null {
  const marker = `-${edition.versionMarker}`
  const at = value.lastIndexOf(marker)
  if (at <= 0) return null
  const core = value.slice(0, at)
  const extension = value.slice(at + marker.length)
  return isReleaseVersion(core) && isReleaseVersion(extension) ? { core, extension } : null
}

// ─── Commands shown to people (Settings → Extensions, docs, get-started) ──

export const INSTALL_SH_URL = 'https://usertasks.com/install.sh'
export const INSTALL_PS1_URL = 'https://usertasks.com/install.ps1'

/** One-line install of an edition (Linux / macOS). */
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

export function editionBundleInstallSh(file = 'usertasks-edition-sharepoint-<version>-linux-amd64.tar'): string {
  return `sh install.sh --bundle ${file}`
}
