/**
 * Package contents ⇄ package files.
 *
 * PackageContents is the logical package (what REST/MCP/UI work with): the
 * header, the scrubbed asset manifest (config-as-code sections), data rows
 * per table, requirements and dependencies. toPackageFiles lays it out as
 * archive files (GitHub-sync layout under assets/, NDJSON rows under data/,
 * README.md); fromPackageFiles reverses it after lib/packages/format has
 * verified every file.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { assetShortId, assetSlug, filesToManifest, manifestToFiles } from '@/lib/github-sync/layout'
import { isSecretKey, SECRET_PLACEHOLDER } from '@/lib/portability/scrub'
import { containsCiphertext, isCiphertext } from '@/lib/secret-format'
import type { PortableRow } from '@/lib/portability/table-rows'
import {
  canonicalJson,
  PACKAGE_ASSETS_PREFIX,
  PACKAGE_DATA_PREFIX,
  PACKAGE_FORMAT_VERSION,
  PACKAGE_KIND,
  PACKAGE_README_FILE,
  type PackageDependency,
  type PackageFileManifest,
  type PackageHeader,
  type PackageRequirement,
  type PackInput,
} from './format'

export interface PackageDataContents {
  mode: 'schema' | 'rows'
  rows?: PortableRow[]
}

export interface PackageContents {
  header: PackageHeader
  /** Config manifest sections (workflows, connectors, …), secrets scrubbed. */
  assets: Record<string, any>
  data: Record<string, PackageDataContents>
  requirements: PackageRequirement[]
  dependencies: PackageDependency[]
}

/** Manifest sections a package may carry (the workspace theme never travels in a package). */
export const PACKAGE_SECTIONS = [
  'email_templates', 'connectors', 'data_tables', 'integrations', 'references', 'objects', 'decision_tables',
  'retention_policies', 'roles', 'mcp_servers', 'workflow_activities', 'reports', 'agents', 'form_themes', 'forms', 'workflows',
  'log_destinations',
] as const

export function countAssets(assets: Record<string, any>): number {
  return PACKAGE_SECTIONS.reduce((sum, section) => sum + (Array.isArray(assets[section]) ? assets[section].length : 0), 0)
}

function rowsFile(tableId: string, tableName: string): string {
  return `${PACKAGE_DATA_PREFIX}/${assetSlug(tableName)}-${assetShortId(tableId)}.ndjson`
}

export function toPackageFiles(contents: PackageContents): Pick<PackInput, 'header' | 'files'> {
  const assets: Record<string, any> = {}
  for (const section of PACKAGE_SECTIONS) if (Array.isArray(contents.assets[section]) && contents.assets[section].length) assets[section] = contents.assets[section]
  const files = manifestToFiles(assets, PACKAGE_ASSETS_PREFIX).map((file) => ({ path: file.path, content: file.content }))
  if (contents.header.readme) files.push({ path: PACKAGE_README_FILE, content: contents.header.readme.endsWith('\n') ? contents.header.readme : `${contents.header.readme}\n` })

  const data: PackageFileManifest['data'] = {}
  const tables = new Map<string, any>((assets.data_tables ?? []).map((table: any) => [String(table.id), table]))
  for (const [tableId, entry] of Object.entries(contents.data)) {
    if (entry.mode === 'rows') {
      const path = rowsFile(tableId, String(tables.get(tableId)?.name ?? 'table'))
      const rows = entry.rows ?? []
      files.push({ path, content: rows.map((row) => canonicalJson({ id: row.id, data: row.data ?? {} })).join('\n') + (rows.length ? '\n' : '') })
      data[tableId] = { mode: 'rows', rows_file: path, row_count: rows.length }
    } else {
      data[tableId] = { mode: 'schema' }
    }
  }
  return {
    header: {
      format_version: PACKAGE_FORMAT_VERSION,
      kind: PACKAGE_KIND,
      package: contents.header,
      data,
      requirements: contents.requirements,
      dependencies: contents.dependencies,
    },
    files,
  }
}

export function fromPackageFiles(manifest: PackageFileManifest, files: Array<{ path: string; content: string }>): { contents: PackageContents; errors: string[] } {
  const errors: string[] = []
  const assetFiles = files.filter((file) => file.path.startsWith(`${PACKAGE_ASSETS_PREFIX}/`))
  const parsed = filesToManifest(assetFiles, PACKAGE_ASSETS_PREFIX)
  for (const error of parsed.errors) errors.push(`${error.path}: ${error.error}`)
  const assets: Record<string, any> = {}
  for (const section of PACKAGE_SECTIONS) if (Array.isArray(parsed.manifest[section])) assets[section] = parsed.manifest[section]

  const byPath = new Map(files.map((file) => [file.path, file.content]))
  const data: PackageContents['data'] = {}
  for (const [tableId, entry] of Object.entries(manifest.data ?? {})) {
    if (entry?.mode !== 'rows') { data[tableId] = { mode: 'schema' }; continue }
    const content = entry.rows_file ? byPath.get(entry.rows_file) : undefined
    if (content === undefined) { errors.push(`Rows file for table ${tableId} is missing`); data[tableId] = { mode: 'schema' }; continue }
    const rows: PortableRow[] = []
    content.split('\n').forEach((line, index) => {
      if (!line.trim()) return
      try {
        const row = JSON.parse(line)
        rows.push({ id: String(row.id ?? `${tableId}:${index}`), data: (row.data ?? {}) as Record<string, unknown> })
      } catch {
        errors.push(`${entry.rows_file} line ${index + 1}: invalid JSON`)
      }
    })
    data[tableId] = { mode: 'rows', rows }
  }
  return {
    contents: {
      header: manifest.package,
      assets,
      data,
      requirements: Array.isArray(manifest.requirements) ? manifest.requirements : [],
      dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies : [],
    },
    errors,
  }
}

/**
 * Build-time guard: no credential may be in an asset file. Every value under
 * a secret key must be the sentinel (or empty / an ${env:} reference) and no
 * `enc:v1:` / `enc:v2:` ciphertext may appear anywhere. Returns the offending paths.
 */
export function findSecretLeaks(files: Array<{ path: string; content: string }>): string[] {
  const leaks: string[] = []
  const walk = (value: unknown, path: string, sensitive: boolean, depth: number) => {
    if (depth > 40) return
    if (typeof value === 'string') {
      if (isCiphertext(value)) leaks.push(`${path} (encrypted value)`)
      else if (sensitive && value !== SECRET_PLACEHOLDER && value !== '' && !/^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) && !value.startsWith('secret://')) leaks.push(path)
      return
    }
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`, sensitive, depth + 1)); return }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key, sensitive || isSecretKey(key), depth + 1)
  }
  for (const file of files) {
    if (file.path.endsWith('.ndjson')) {
      if (containsCiphertext(file.content)) leaks.push(`${file.path} (encrypted value in rows)`)
      continue
    }
    if (!file.path.endsWith('.json')) continue
    try {
      walk(JSON.parse(file.content), file.path, false, 0)
    } catch {
      // Not JSON: nothing to check.
    }
  }
  return leaks
}
