import { resolveProviderSecretRefs } from '@/lib/config'
import { buildPublicConfig, type PublicConfig } from '@/lib/config/public'
import type { ProviderId } from '@/lib/config/schema'
import { copyStorageObjects, rewriteStorageUrls, STORAGE_URL_COLUMNS, type RewriteDb, type StorageColumn } from '@/lib/storage/migrate'
import { STORAGE_BUCKETS, STORAGE_BUCKET_NAMES } from '@/lib/storage/buckets'
import { publicBasesFor, type StorageOptions } from '@/lib/providers/storage/options'
import type { StorageProvider } from '@/lib/providers/storage/types'
import type { SqlClient } from '../ops/instance-db'
import { readJsonl, writeJsonl } from './backup'
import type { AreaSwitch, PreflightCheck, SwitchContext } from './types'

/**
 * storage: any pair of supabase / local / s3 / azure_blob / gcs.
 *  1. copy every object of the app's buckets, verifying each copy by
 *     SHA-256 (lib/storage/migrate copyStorageObjects; re-runs skip
 *     unchanged objects);
 *  2. rewrite persisted own-storage URLs (logos, theme assets, icons become
 *     `storage://` refs; file objects in data keep a URL re-pointed at the
 *     target) — every changed column value is saved first to
 *     url-rewrite.jsonl as {before, after};
 *  3. verify every source object exists in the target.
 * Rollback restores each rewritten value whose current value is still the
 * one the switch wrote (later edits are kept and reported). Objects copied
 * to the target are left there.
 */

const REWRITE_FILE = 'url-rewrite.jsonl'

interface RewriteEntry {
  table: string
  column: string
  key: string
  id: string
  before: unknown
  after: unknown
}

/** Minimal `.from()` client over pg for rewriteStorageUrls (select/order/range, update/eq). */
export function pgRewriteDb(db: SqlClient): RewriteDb {
  const q = (name: string) => `"${name.replace(/"/g, '""')}"`
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const cols = columns.split(',').map((c) => c.trim())
          let orderBy = ''
          return {
            order(column: string, opts: { ascending?: boolean } = {}) {
              orderBy = ` ORDER BY ${q(column)} ${opts.ascending === false ? 'DESC' : 'ASC'}`
              return this
            },
            async range(from: number, to: number) {
              try {
                const { rows } = await db.query(`SELECT ${cols.map(q).join(', ')} FROM public.${q(table)}${orderBy} LIMIT ${to - from + 1} OFFSET ${from}`)
                return { data: rows, error: null }
              } catch (error) {
                return { data: null, error: { message: (error as Error).message } }
              }
            },
          }
        },
        update(values: Record<string, unknown>) {
          const [[column, value]] = Object.entries(values)
          return {
            async eq(key: string, id: unknown) {
              try {
                await db.query(`UPDATE public.${q(table)} SET ${q(column)} = $1 WHERE ${q(key)} = $2`, [JSON.stringify(value), id])
                return { error: null }
              } catch (error) {
                return { error: { message: (error as Error).message } }
              }
            },
          }
        },
      }
    },
  }
}

async function providerFor(ctx: SwitchContext, which: 'source' | 'target'): Promise<{ id: ProviderId<'storage'>; options: StorageOptions; provider: StorageProvider }> {
  const config = await resolveProviderSecretRefs(which === 'source' ? ctx.config : ctx.targetConfig, 'storage')
  const { resolveStorageProvider } = await import('@/lib/providers/storage')
  return { id: config.id, options: config.options, provider: resolveStorageProvider(config.id, config.options) }
}

function buckets(ctx: SwitchContext): string[] {
  const flag = ctx.options.flags.bucket
  const list = Array.isArray(flag) ? flag : typeof flag === 'string' ? [flag] : []
  // Transient buckets (job results) are not carried over unless named.
  return list.length ? list.flatMap((b) => b.split(',')).map((b) => b.trim()).filter(Boolean) : STORAGE_BUCKET_NAMES.filter((name) => !(STORAGE_BUCKETS[name] as { transient?: boolean }).transient)
}

function prefix(ctx: SwitchContext): string | undefined {
  return typeof ctx.options.flags.prefix === 'string' ? ctx.options.flags.prefix : undefined
}

/** Public config of the source install: what its stored URLs look like. */
function sourcePublicConfig(id: string, options: StorageOptions): PublicConfig {
  const rest: PublicConfig = { ...buildPublicConfig(), storage: undefined }
  if (id === 'supabase') return rest
  const publicBases = id === 'local' ? undefined : publicBasesFor(options)
  return { ...rest, storage: { provider: id as Exclude<ProviderId<'storage'>, 'supabase'>, ...(publicBases ? { publicBases } : {}) } }
}

function columns(ctx: SwitchContext): StorageColumn[] {
  const only = ctx.options.flags.columns
  if (typeof only !== 'string') return STORAGE_URL_COLUMNS
  const wanted = new Set(only.split(',').map((s) => s.trim()))
  return STORAGE_URL_COLUMNS.filter((c) => wanted.has(`${c.table}.${c.column}`) || wanted.has(c.table))
}

async function probe(provider: StorageProvider, bucket: string): Promise<void> {
  const key = `_doctor/switch-probe-${Date.now()}.txt`
  await provider.ensureBucket(bucket, { public: true })
  await provider.put(bucket, key, new TextEncoder().encode('probe'), { contentType: 'text/plain', upsert: true })
  try {
    if (!(await provider.head(bucket, key))) throw new Error('probe object missing after write')
  } finally {
    await provider.delete(bucket, [key]).catch(() => undefined)
  }
}

export const storageSwitch: AreaSwitch = {
  area: 'storage',
  writesProviderSetting: true,
  supports: () => null,
  async preflight(ctx) {
    const checks: PreflightCheck[] = []
    for (const which of ['source', 'target'] as const) {
      try {
        const { id, provider } = await providerFor(ctx, which)
        if (which === 'source') {
          await provider.list(buckets(ctx)[0], '', { limit: 1 })
          checks.push({ name: 'source', severity: 'ok', detail: `${id} reachable` })
        } else {
          await probe(provider, buckets(ctx)[0])
          checks.push({ name: 'target', severity: 'ok', detail: `${id} writable (probe object written and removed)` })
        }
      } catch (error) {
        checks.push({ name: which, severity: 'error', detail: (error as Error).message })
      }
    }
    return checks
  },
  steps(ctx) {
    const copyOpts = () => ({ buckets: buckets(ctx), prefix: prefix(ctx), overwrite: ctx.options.flags.overwrite === true })
    return [
      {
        id: 'copy',
        title: 'Copy objects (SHA-256 verified)',
        async plan() {
          const [source, target] = await Promise.all([providerFor(ctx, 'source'), providerFor(ctx, 'target')])
          const report = await copyStorageObjects(source.provider, target.provider, { ...copyOpts(), dryRun: true })
          const total = report.buckets.reduce((n, b) => n + b.objects, 0)
          const conflicts = report.buckets.reduce((n, b) => n + b.conflicts.length, 0)
          return `${total} object(s) in ${report.buckets.length} bucket(s); ${report.buckets.reduce((n, b) => n + b.unchanged, 0)} already copied${conflicts ? `; ${conflicts} conflict(s) (--overwrite)` : ''}`
        },
        async run() {
          const [source, target] = await Promise.all([providerFor(ctx, 'source'), providerFor(ctx, 'target')])
          // Count first (listing only) so the switch log can show a percentage.
          let total = 0
          for (const bucket of copyOpts().buckets) {
            let cursor: string | null = null
            do {
              const page = await source.provider.list(bucket, prefix(ctx) ?? '', { limit: 500, cursor })
              cursor = page.cursor
              total += page.objects.length
            } while (cursor)
          }
          let seen = 0
          const report = await copyStorageObjects(source.provider, target.provider, {
            ...copyOpts(),
            onObject: () => { seen++; if (total) ctx.progress(seen / total) },
          })
          const sum = (f: (b: (typeof report.buckets)[number]) => number) => report.buckets.reduce((n, b) => n + f(b), 0)
          const failed = report.buckets.flatMap((b) => b.failed.map((f) => `${b.bucket}/${f.key}: ${f.error}`))
          const conflicts = report.buckets.flatMap((b) => b.conflicts.map((k) => `${b.bucket}/${k}`))
          if (!report.ok) throw new Error(`copy incomplete: ${failed.length} failed, ${conflicts.length} conflict(s) (re-run with --overwrite to replace) — ${[...failed, ...conflicts].slice(0, 5).join('; ')}`)
          return `${sum((b) => b.objects)} object(s), ${sum((b) => b.copied)} copied, ${sum((b) => b.unchanged)} unchanged, ${sum((b) => b.bytes)} bytes`
        },
      },
      {
        id: 'rewrite',
        title: 'Rewrite stored file URLs',
        async plan() {
          const [source, target] = await Promise.all([providerFor(ctx, 'source'), providerFor(ctx, 'target')])
          const report = await rewriteStorageUrls(pgRewriteDb(ctx.db), {
            sourceConfig: sourcePublicConfig(source.id, source.options), targetUrl: (b, k) => target.provider.publicUrl(b, k), dryRun: true, columns: columns(ctx),
          })
          return `${report.urlsChanged} URL(s) in ${report.rowsChanged} row(s)`
        },
        async run() {
          const [source, target] = await Promise.all([providerFor(ctx, 'source'), providerFor(ctx, 'target')])
          const options = { sourceConfig: sourcePublicConfig(source.id, source.options), targetUrl: (b: string, k: string) => target.provider.publicUrl(b, k), columns: columns(ctx) }
          const db = pgRewriteDb(ctx.db)
          const planned = await rewriteStorageUrls(db, { ...options, dryRun: true, maxChangesPerColumn: Number.MAX_SAFE_INTEGER })
          // Snapshot the values about to change, then rewrite, then record what was written.
          const entries: RewriteEntry[] = []
          for (const col of planned.columns) {
            if (!col.changes.length) continue
            const spec = STORAGE_URL_COLUMNS.find((c) => c.table === col.table && c.column === col.column)!
            const ids = col.changes.map((c) => c.id)
            const { rows } = await ctx.db.query<{ id: string; v: unknown }>(`SELECT "${spec.key}"::text AS id, "${spec.column}" AS v FROM public."${spec.table}" WHERE "${spec.key}"::text = ANY($1::text[])`, [ids])
            for (const row of rows) entries.push({ table: spec.table, column: spec.column, key: spec.key, id: row.id, before: row.v, after: null })
          }
          const previous = readJsonl<RewriteEntry>(ctx.backupDir, REWRITE_FILE) ?? []
          writeJsonl(ctx.backupDir, REWRITE_FILE, [...previous, ...entries])
          const report = await rewriteStorageUrls(db, { ...options, dryRun: false })
          for (const entry of entries) {
            const { rows } = await ctx.db.query<{ v: unknown }>(`SELECT "${entry.column}" AS v FROM public."${entry.table}" WHERE "${entry.key}"::text = $1`, [entry.id])
            entry.after = rows[0]?.v ?? null
          }
          writeJsonl(ctx.backupDir, REWRITE_FILE, [...previous, ...entries])
          const skipped = report.columns.filter((c) => c.skipped).map((c) => `${c.table}.${c.column}`)
          return `${report.urlsChanged} URL(s) in ${report.rowsChanged} row(s) rewritten${skipped.length ? `; skipped (not on this install): ${skipped.join(', ')}` : ''}`
        },
      },
      {
        id: 'verify',
        title: 'Verify objects in the target',
        async run() {
          const [source, target] = await Promise.all([providerFor(ctx, 'source'), providerFor(ctx, 'target')])
          let checked = 0
          const missing: string[] = []
          for (const bucket of buckets(ctx)) {
            let cursor: string | null = null
            do {
              const page = await source.provider.list(bucket, prefix(ctx) ?? '', { limit: 500, cursor })
              cursor = page.cursor
              for (const object of page.objects) {
                checked++
                const head = await target.provider.head(bucket, object.key)
                if (!head || (object.size >= 0 && head.size !== object.size)) missing.push(`${bucket}/${object.key}`)
              }
            } while (cursor)
          }
          if (missing.length) throw new Error(`${missing.length} object(s) missing or different in the target: ${missing.slice(0, 5).join(', ')}`)
          ctx.notes.push('Public file URLs follow the new provider within a minute (instance settings cache); no restart needed unless STORAGE_PROVIDER is set in the environment.')
          return `${checked} object(s) present in the target`
        },
      },
    ]
  },
  async rollback(ctx) {
    if (!ctx.backupDir) return ['no backup directory: stored URLs left as they are']
    const entries = readJsonl<RewriteEntry>(ctx.backupDir, REWRITE_FILE)
    if (!entries?.length) return ['no URL rewrites to undo']
    let restored = 0
    const kept: string[] = []
    for (const entry of entries) {
      if (entry.after === null) continue
      if (ctx.dryRun) { restored++; continue }
      const { rowCount } = await ctx.db.query(
        `UPDATE public."${entry.table}" SET "${entry.column}" = $1::jsonb WHERE "${entry.key}"::text = $2 AND "${entry.column}"::jsonb = $3::jsonb`,
        [JSON.stringify(entry.before), entry.id, JSON.stringify(entry.after)],
      )
      if ((rowCount ?? 0) > 0) restored++
      else kept.push(`${entry.table}.${entry.column} ${entry.id}`)
    }
    return [
      `${ctx.dryRun ? 'would restore' : 'restored'} ${restored} stored value(s)`,
      ...(kept.length ? [`kept ${kept.length} value(s) edited since the switch: ${kept.slice(0, 5).join(', ')}`] : []),
      'objects copied to the target were left in place',
    ]
  },
}
