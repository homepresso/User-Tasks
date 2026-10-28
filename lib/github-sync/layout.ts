/**
 * Repo layout rules for GitHub sync.
 *
 *   {path_prefix}/manifest.json
 *   {path_prefix}/{asset_type}/{slug}-{shortid}.json
 *
 * File identity is the shortid (first 8 hex chars of the asset UUID) — the
 * slug is cosmetic and re-derived from the current name, so renames move the
 * file (old path deleted + new path added in the same commit).
 */

export const GITHUB_SYNC_FORMAT_VERSION = 3
export const DEFAULT_PATH_PREFIX = 'usertasks'

export function assetSlug(name: string): string {
  return (
    String(name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  )
}

export function assetShortId(id: string): string {
  return String(id).replace(/-/g, '').slice(0, 8)
}

export function assetFilePath(pathPrefix: string, assetType: string, name: string, id: string): string {
  const prefix = pathPrefix.replace(/\/+$/g, '') || DEFAULT_PATH_PREFIX
  return `${prefix}/${assetType}/${assetSlug(name)}-${assetShortId(id)}.json`
}

export function manifestPath(pathPrefix: string): string {
  const prefix = pathPrefix.replace(/\/+$/g, '') || DEFAULT_PATH_PREFIX
  return `${prefix}/manifest.json`
}

export interface ManifestIndexEntry {
  asset_type: string
  id: string
  name: string
  slug: string
  file: string
  updated_at: string | null
}

export interface SyncManifest {
  format_version: number
  generator: 'usertasks'
  exported_at: string
  source: { tenant_slug?: string | null }
  index: ManifestIndexEntry[]
}

export function buildAssetEnvelope(assetType: string, id: string, asset: unknown) {
  return {
    format_version: GITHUB_SYNC_FORMAT_VERSION,
    asset_type: assetType,
    id,
    exported_at: new Date().toISOString(),
    asset,
  }
}

/** Stable, diff-friendly JSON: 2-space indent + trailing newline. */
export function stringifyForRepo(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests and envelopes are free-form JSON */

// ─── Manifest ⇄ files ───────────────────────────────────────────────────────
//
// The same layout serves the GitHub-sync repo (push/deploy) and config-as-code
// (`/api/v1/config/export|apply`, `usertasks config …`). Both helpers are pure:
// no I/O, no clock beyond envelope/manifest timestamps.

/** Manifest section key → repo directory used in file paths. */
export const SECTION_TO_DIR: ReadonlyArray<{ section: string; dir: string }> = [
  { section: 'workflows', dir: 'workflows' },
  { section: 'data_tables', dir: 'data-tables' },
  { section: 'decision_tables', dir: 'decision-tables' },
  { section: 'integrations', dir: 'integrations' },
  { section: 'references', dir: 'references' },
  { section: 'objects', dir: 'objects' },
  { section: 'retention_policies', dir: 'retention-policies' },
  { section: 'agents', dir: 'agents' },
  { section: 'reports', dir: 'reports' },
  { section: 'workflow_activities', dir: 'workflow-activities' },
  { section: 'roles', dir: 'roles' },
  { section: 'mcp_servers', dir: 'mcp-servers' },
  { section: 'email_templates', dir: 'email-templates' },
  { section: 'connectors', dir: 'connectors' },
  { section: 'log_destinations', dir: 'log-destinations' },
  { section: 'form_themes', dir: 'form-themes' },
  { section: 'forms', dir: 'forms' },
  // Opt-in data-table rows (config export include_rows; packages): one file
  // per table, the asset id is the table id. Never pushed by GitHub sync.
  { section: 'table_rows', dir: 'data-rows' },
]

/**
 * Singleton sections: one object per workspace (not an asset list), stored as
 * one file at the folder root. Config-as-code reads and writes it; GitHub
 * push/deploy don't carry it (yet).
 */
export const SINGLETON_SECTIONS: ReadonlyArray<{ section: string; file: string }> = [
  { section: 'workspace_theme', file: 'workspace-theme.json' },
]
/** Envelope / index id of a singleton (it has no asset id of its own). */
export const SINGLETON_ID = 'workspace'

export interface RepoFile {
  path: string
  content: string
}

/**
 * Prefix as used by push/deploy: trailing slashes trimmed, empty falls back
 * to DEFAULT_PATH_PREFIX (the assetFilePath / manifestPath rule).
 */
export function repoPathPrefix(pathPrefix: string | null | undefined): string {
  return String(pathPrefix ?? '').replace(/\/+$/g, '') || DEFAULT_PATH_PREFIX
}

/** `prefix/rel`, or `rel` when the prefix is empty (config-as-code folders). */
function joinPrefix(prefix: string, rel: string): string {
  const trimmed = prefix.replace(/\/+$/g, '')
  return trimmed ? `${trimmed}/${rel}` : rel
}

export function layoutAssetName(asset: Record<string, any>): string {
  return String(asset?.name ?? asset?.title ?? asset?.label ?? 'untitled')
}

/**
 * File + index entry for one asset. `prefix` is used literally ('' = no
 * prefix); push/deploy pass repoPathPrefix(connection.pathPrefix).
 */
export function assetRepoFile(prefix: string, section: string, asset: Record<string, any>): { file: RepoFile; entry: ManifestIndexEntry } {
  const dir = SECTION_TO_DIR.find((s) => s.section === section)?.dir ?? section
  const name = layoutAssetName(asset)
  const id = String(asset.id)
  const path = joinPrefix(prefix, `${dir}/${assetSlug(name)}-${assetShortId(id)}.json`)
  return {
    file: { path, content: stringifyForRepo(buildAssetEnvelope(section, id, asset)) },
    entry: {
      asset_type: section,
      id,
      name,
      slug: path.split('/').pop()!.replace(/\.json$/, ''),
      file: path,
      updated_at: (asset?.updated_at as string | undefined) ?? null,
    },
  }
}

/**
 * Asset files + index for every asset (with an id) in the known sections,
 * in SECTION_TO_DIR order. `include` narrows the selection (scoped pushes).
 */
export function planManifestFiles(
  manifest: Record<string, any>,
  prefix: string,
  include?: (section: string, asset: Record<string, any>) => boolean,
): { files: RepoFile[]; index: ManifestIndexEntry[] } {
  const files: RepoFile[] = []
  const index: ManifestIndexEntry[] = []
  for (const { section } of SECTION_TO_DIR) {
    const assets = manifest[section]
    if (!Array.isArray(assets)) continue
    for (const asset of assets) {
      if (!asset?.id) continue
      if (include && !include(section, asset)) continue
      const { file, entry } = assetRepoFile(prefix, section, asset)
      files.push(file)
      index.push(entry)
    }
  }
  for (const { section, file: name } of SINGLETON_SECTIONS) {
    const asset = manifest[section]
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) continue
    if (include && !include(section, asset)) continue
    const path = joinPrefix(prefix, name)
    files.push({ path, content: stringifyForRepo(buildAssetEnvelope(section, SINGLETON_ID, asset)) })
    index.push({ asset_type: section, id: SINGLETON_ID, name: layoutAssetName(asset?.meta ?? asset), slug: name.replace(/\.json$/, ''), file: path, updated_at: null })
  }
  return { files, index }
}

export function buildSyncManifest(index: ManifestIndexEntry[]): SyncManifest {
  return {
    format_version: GITHUB_SYNC_FORMAT_VERSION,
    generator: 'usertasks',
    exported_at: new Date().toISOString(),
    source: {},
    index: index.sort((a, b) => a.file.localeCompare(b.file)),
  }
}

/** Every asset file plus `manifest.json`. `prefix` defaults to '' (no prefix). */
export function manifestToFiles(manifest: Record<string, any>, prefix = ''): RepoFile[] {
  const { files, index } = planManifestFiles(manifest, prefix)
  return [...files, { path: joinPrefix(prefix, 'manifest.json'), content: stringifyForRepo(buildSyncManifest(index)) }]
}

export interface FilesToManifestError {
  path: string
  error: string
}

export interface FilesToManifestOptions {
  /**
   * true = only files listed in manifest.json's index are read, in index
   * order, and unlisted files are ignored (GitHub deploy semantics).
   * false (default) = every `.json` file under the prefix is read; indexed
   * files keep index order, the rest follow sorted by path — so hand-made
   * files (`usertasks config new`) need no index entry.
   */
  indexOnly?: boolean
}

const SECTION_BY_KEY: Record<string, string> = Object.fromEntries(
  SECTION_TO_DIR.flatMap(({ section, dir }) => [[section, section], [dir, section]]),
)
const SINGLETON_BY_KEY: Record<string, string> = Object.fromEntries(
  SINGLETON_SECTIONS.flatMap(({ section, file }) => [[section, section], [file.replace(/\.json$/, ''), section]]),
)

/**
 * Rebuild a manifest from repo files. Unparseable or malformed envelopes are
 * reported in `errors` (and skipped) instead of throwing.
 */
export function filesToManifest(
  files: ReadonlyArray<RepoFile>,
  prefix = '',
  options: FilesToManifestOptions = {},
): { manifest: Record<string, any>; errors: FilesToManifestError[]; paths: Record<string, string[]> } {
  const errors: FilesToManifestError[] = []
  /** Source file of every asset, parallel to manifest[section]. */
  const paths: Record<string, string[]> = {}
  const base = prefix.replace(/\/+$/g, '')
  const inPrefix = (path: string) => !base || path.startsWith(`${base}/`)
  const byPath = new Map(files.filter((f) => options.indexOnly || inPrefix(f.path)).map((f) => [f.path, f.content]))
  const manifestFile = joinPrefix(base, 'manifest.json')

  let syncManifest: Partial<SyncManifest> = {}
  const rawManifest = byPath.get(manifestFile)
  if (rawManifest !== undefined) {
    try {
      syncManifest = JSON.parse(rawManifest) as SyncManifest
    } catch (error) {
      errors.push({ path: manifestFile, error: `Invalid JSON: ${(error as Error).message}` })
    }
  }
  const index = Array.isArray(syncManifest.index) ? syncManifest.index : []

  const manifest: Record<string, any> = { format_version: syncManifest.format_version ?? GITHUB_SYNC_FORMAT_VERSION }
  const push = (section: string, asset: unknown, path: string) => {
    if (SINGLETON_BY_KEY[section]) {
      const key = SINGLETON_BY_KEY[section]
      if (manifest[key] !== undefined) {
        errors.push({ path, error: `Only one ${key} file is allowed (${paths[key]?.[0]} already has one)` })
        return
      }
      manifest[key] = asset
      paths[key] = [path]
      return
    }
    if (!manifest[section]) manifest[section] = []
    manifest[section].push(asset)
    ;(paths[section] ??= []).push(path)
  }

  if (options.indexOnly) {
    for (const entry of index) {
      const content = byPath.get(entry.file)
      if (content === undefined) continue // listed but missing — skip, preflight will surface counts
      const envelope = JSON.parse(content)
      push(String(envelope.asset_type ?? entry.asset_type), envelope.asset, entry.file)
    }
    return { manifest, errors, paths }
  }

  const indexed = index.map((entry) => entry.file).filter((path) => byPath.has(path))
  const indexedSet = new Set(indexed)
  const rest = [...byPath.keys()]
    .filter((path) => path !== manifestFile && path.endsWith('.json') && !indexedSet.has(path))
    .sort((a, b) => a.localeCompare(b))

  for (const path of [...new Set(indexed), ...rest]) {
    let envelope: any
    try {
      envelope = JSON.parse(byPath.get(path)!)
    } catch (error) {
      errors.push({ path, error: `Invalid JSON: ${(error as Error).message}` })
      continue
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      errors.push({ path, error: 'Not an asset envelope (expected an object with asset_type and asset)' })
      continue
    }
    const section = SECTION_BY_KEY[String(envelope.asset_type ?? '')] ?? SINGLETON_BY_KEY[String(envelope.asset_type ?? '')]
    if (!section) {
      errors.push({ path, error: `Unknown asset_type "${String(envelope.asset_type ?? '')}"` })
      continue
    }
    const asset = envelope.asset
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      errors.push({ path, error: 'Envelope has no asset object' })
      continue
    }
    if (SINGLETON_BY_KEY[section]) {
      push(section, asset, path)
      continue
    }
    if (envelope.id && asset.id && String(envelope.id) !== String(asset.id)) {
      errors.push({ path, error: `Envelope id ${envelope.id} does not match asset id ${asset.id}` })
      continue
    }
    push(section, envelope.id && !asset.id ? { ...asset, id: String(envelope.id) } : asset, path)
  }
  return { manifest, errors, paths }
}
