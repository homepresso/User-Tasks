import { createHash } from 'node:crypto'
import type { PublicConfig } from '@/lib/config/public'
import type { StorageProvider } from '@/lib/providers/storage/types'
import { readAll } from '@/lib/providers/storage/types'
import { STORAGE_BUCKETS, STORAGE_BUCKET_NAMES } from './buckets'
import { formatStorageRef, parseOwnStorageUrl } from './refs'

/**
 * Storage migration building blocks (the admin CLI's `switch storage` uses
 * them in a later phase):
 *
 *  - copyStorageObjects(): copy every object of the app's buckets from one
 *    provider to another (any pair: supabase, s3, local, azure_blob, gcs),
 *    verifying each copy by reading it back and comparing SHA-256.
 *  - rewriteStorageUrls(): find persisted own-storage URLs in the known
 *    columns and rewrite them (dry run by default, with a report):
 *      * values the app renders itself (logos, theme images and fonts,
 *        integration / reference / node icons) become `storage://` refs;
 *      * file objects (`{ url, path, … }` in data-table rows, workflow
 *        outputs, task data) keep a usable `url`, re-pointed at the target
 *        provider, and gain `ref`;
 *      * any other own-storage URL string in workflow / task / run data is
 *        re-pointed at the target (it may be sent to external systems, so it
 *        stays a URL).
 *    Audit logs and call logs are history and are left alone.
 */

// ── object copy ─────────────────────────────────────────────────────────────

export interface CopyObjectsOptions {
  buckets?: readonly string[]
  /** Only keys under this prefix. */
  prefix?: string
  /** Replace objects that already exist in the target with different content (default: report as conflict). */
  overwrite?: boolean
  /** List and checksum only; write nothing. */
  dryRun?: boolean
  pageSize?: number
  onObject?: (event: CopyObjectEvent) => void
}

export interface CopyObjectEvent {
  bucket: string
  key: string
  status: 'copied' | 'unchanged' | 'conflict' | 'failed' | 'planned'
  size: number
  sha256?: string
  error?: string
}

export interface CopyBucketReport {
  bucket: string
  objects: number
  bytes: number
  copied: number
  unchanged: number
  conflicts: string[]
  failed: Array<{ key: string; error: string }>
}

export interface CopyObjectsReport {
  dryRun: boolean
  buckets: CopyBucketReport[]
  ok: boolean
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readObject(provider: StorageProvider, bucket: string, key: string): Promise<{ bytes: Uint8Array; contentType: string | null; cacheControl: string | null } | null> {
  const object = await provider.get(bucket, key)
  if (!object) return null
  return { bytes: await readAll(object.body), contentType: object.contentType, cacheControl: object.cacheControl }
}

export async function copyStorageObjects(source: StorageProvider, target: StorageProvider, options: CopyObjectsOptions = {}): Promise<CopyObjectsReport> {
  // Job results expire within days; a migration doesn't carry them over.
  const buckets = options.buckets ?? STORAGE_BUCKET_NAMES.filter((name) => !(STORAGE_BUCKETS[name] as { transient?: boolean }).transient)
  const report: CopyObjectsReport = { dryRun: Boolean(options.dryRun), buckets: [], ok: true }
  for (const bucket of buckets) {
    const result: CopyBucketReport = { bucket, objects: 0, bytes: 0, copied: 0, unchanged: 0, conflicts: [], failed: [] }
    report.buckets.push(result)
    if (!options.dryRun) {
      const isPublic = (STORAGE_BUCKETS as Record<string, { public: boolean }>)[bucket]?.public ?? false
      await target.ensureBucket(bucket, { public: isPublic })
    }
    let cursor: string | null = null
    do {
      const page = await source.list(bucket, options.prefix ?? '', { limit: options.pageSize ?? 500, cursor })
      cursor = page.cursor
      for (const info of page.objects) {
        result.objects++
        const emit = (event: Omit<CopyObjectEvent, 'bucket' | 'key'>) => options.onObject?.({ bucket, key: info.key, ...event })
        try {
          const object = await readObject(source, bucket, info.key)
          if (!object) throw new Error('disappeared from the source')
          const digest = sha256(object.bytes)
          result.bytes += object.bytes.byteLength
          const existing = await target.head(bucket, info.key)
          if (existing) {
            const current = await readObject(target, bucket, info.key)
            if (current && sha256(current.bytes) === digest) {
              result.unchanged++
              emit({ status: 'unchanged', size: object.bytes.byteLength, sha256: digest })
              continue
            }
            if (!options.overwrite) {
              result.conflicts.push(info.key)
              emit({ status: 'conflict', size: object.bytes.byteLength, sha256: digest })
              continue
            }
          }
          if (options.dryRun) {
            emit({ status: 'planned', size: object.bytes.byteLength, sha256: digest })
            continue
          }
          await target.put(bucket, info.key, object.bytes, {
            contentType: object.contentType ?? undefined,
            ...(object.cacheControl ? { cacheControl: object.cacheControl } : {}),
            upsert: true,
          })
          const written = await readObject(target, bucket, info.key)
          if (!written || sha256(written.bytes) !== digest) throw new Error('checksum mismatch after copy')
          result.copied++
          emit({ status: 'copied', size: object.bytes.byteLength, sha256: digest })
        } catch (e) {
          const error = (e as Error).message
          result.failed.push({ key: info.key, error })
          emit({ status: 'failed', size: info.size, error })
        }
      }
    } while (cursor)
    if (result.failed.length || result.conflicts.length) report.ok = false
  }
  return report
}

// ── persisted URL rewrite ───────────────────────────────────────────────────

/** Keys whose values the app renders itself: stored as `storage://` refs. */
export const ASSET_URL_KEYS = new Set(['logo_url', 'logoLight', 'logoDark', 'favicon', 'icon_url', 'node_icon_url'])

export interface StorageColumn {
  table: string
  column: string
  /** Primary key column(s) used to update the row. */
  key: string
  /**
   * 'asset': every own-storage string becomes a ref (branding, theme, icons).
   * 'data': file objects get `ref` + a target URL; other own URLs are
   * re-pointed at the target, except under ASSET_URL_KEYS (refs).
   */
  mode: 'asset' | 'data'
}

/** Every column known to persist storage URLs. */
export const STORAGE_URL_COLUMNS: StorageColumn[] = [
  { table: 'tenants', column: 'branding', key: 'id', mode: 'asset' },
  { table: 'workspace_themes', column: 'theme', key: 'tenant_id', mode: 'asset' },
  { table: 'integrations', column: 'config', key: 'id', mode: 'asset' },
  { table: 'integration_references', column: 'request_config', key: 'id', mode: 'asset' },
  { table: 'custom_table_rows', column: 'data', key: 'id', mode: 'data' },
  { table: 'workflows', column: 'nodes', key: 'id', mode: 'data' },
  { table: 'workflow_versions', column: 'nodes', key: 'id', mode: 'data' },
  { table: 'workflow_runs', column: 'node_results', key: 'id', mode: 'data' },
  { table: 'workflow_runs', column: 'pause_variables', key: 'id', mode: 'data' },
  { table: 'workflow_runs', column: 'execution_trace', key: 'id', mode: 'data' },
  { table: 'workflow_queue', column: 'result', key: 'id', mode: 'data' },
  { table: 'workflow_queue', column: 'trigger_data', key: 'id', mode: 'data' },
  { table: 'tasks', column: 'metadata', key: 'id', mode: 'data' },
  { table: 'agent_runs', column: 'outputs', key: 'id', mode: 'data' },
  { table: 'agent_runs', column: 'context', key: 'id', mode: 'data' },
]

export interface RewriteOptions {
  /**
   * Config used to recognise legacy URLs: the source install's Supabase URL
   * (and APP_URL / public bases for /files or CDN URLs).
   */
  sourceConfig: PublicConfig
  /** Usable URL of an object with the target provider (target.publicUrl). */
  targetUrl: (bucket: string, key: string) => string
}

export interface StorageUrlChange {
  /** JSON path inside the column, e.g. `branding.logo_url` or `col_3.url`. */
  path: string
  from: string
  to: string
}

/** Rewrite own-storage URLs in one JSON value (pure). */
export function rewriteStorageJson(value: unknown, mode: StorageColumn['mode'], options: RewriteOptions): { value: unknown; changes: StorageUrlChange[] } {
  const changes: StorageUrlChange[] = []
  const own = (text: string) => {
    const ref = parseOwnStorageUrl(text, options.sourceConfig)
    return ref && ref.form !== 'ref' ? ref : null
  }
  const visit = (node: unknown, path: string, key: string | null): unknown => {
    if (typeof node === 'string') {
      const ref = own(node)
      if (!ref) return node
      const to = mode === 'asset' || (key !== null && ASSET_URL_KEYS.has(key))
        ? formatStorageRef(ref.bucket, ref.key, ref.search)
        : `${options.targetUrl(ref.bucket, ref.key)}${ref.search}`
      if (to !== node) changes.push({ path, from: node, to })
      return to
    }
    if (Array.isArray(node)) return node.map((item, i) => visit(item, `${path}[${i}]`, null))
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      // File object: keep a usable url, add the reference.
      if (mode === 'data' && typeof obj.url === 'string' && typeof obj.path === 'string') {
        const ref = own(obj.url)
        if (ref) {
          const url = `${options.targetUrl(ref.bucket, ref.key)}${ref.search}`
          const storageRef = formatStorageRef(ref.bucket, ref.key)
          const next: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(obj)) next[k] = k === 'url' ? url : visit(v, path ? `${path}.${k}` : k, k)
          next.ref = storageRef
          if (url !== obj.url) changes.push({ path: path ? `${path}.url` : 'url', from: obj.url, to: url })
          if (obj.ref !== storageRef) changes.push({ path: path ? `${path}.ref` : 'ref', from: String(obj.ref ?? ''), to: storageRef })
          return next
        }
      }
      const next: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(obj)) next[k] = visit(v, path ? `${path}.${k}` : k, k)
      return next
    }
    return node
  }
  const rewritten = visit(value, '', null)
  return { value: changes.length ? rewritten : value, changes }
}

/** Minimal client surface (supabase-js / pg-query service client). */
export interface RewriteDb {
  from(table: string): any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ColumnRewriteReport {
  table: string
  column: string
  rowsScanned: number
  rowsChanged: number
  changes: Array<{ id: string; changes: StorageUrlChange[] }>
  /** Column / table missing on this install, or a read error. */
  skipped?: string
}

export interface RewriteReport {
  dryRun: boolean
  columns: ColumnRewriteReport[]
  rowsChanged: number
  urlsChanged: number
}

/**
 * Walk every known column and rewrite own-storage URLs (dryRun: report only).
 * Rows are read in pages ordered by key; only changed rows are updated.
 */
export async function rewriteStorageUrls(
  db: RewriteDb,
  options: RewriteOptions & { dryRun?: boolean; columns?: StorageColumn[]; pageSize?: number; maxChangesPerColumn?: number },
): Promise<RewriteReport> {
  const dryRun = options.dryRun !== false
  const pageSize = options.pageSize ?? 500
  const report: RewriteReport = { dryRun, columns: [], rowsChanged: 0, urlsChanged: 0 }
  for (const col of options.columns ?? STORAGE_URL_COLUMNS) {
    const result: ColumnRewriteReport = { table: col.table, column: col.column, rowsScanned: 0, rowsChanged: 0, changes: [] }
    report.columns.push(result)
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from(col.table).select(`${col.key}, ${col.column}`).order(col.key, { ascending: true }).range(from, from + pageSize - 1)
      if (error) { result.skipped = error.message ?? String(error); break }
      const rows = (data ?? []) as Array<Record<string, unknown>>
      for (const row of rows) {
        result.rowsScanned++
        const value = row[col.column]
        if (value === null || value === undefined) continue
        const { value: next, changes } = rewriteStorageJson(value, col.mode, options)
        if (!changes.length) continue
        result.rowsChanged++
        report.rowsChanged++
        report.urlsChanged += changes.length
        if (result.changes.length < (options.maxChangesPerColumn ?? 1000)) result.changes.push({ id: String(row[col.key]), changes })
        if (!dryRun) {
          const { error: updateError } = await db.from(col.table).update({ [col.column]: next }).eq(col.key, row[col.key])
          if (updateError) throw new Error(`${col.table}.${col.column} ${String(row[col.key])}: ${updateError.message ?? updateError}`)
        }
      }
      if (rows.length < pageSize) break
    }
  }
  return report
}
