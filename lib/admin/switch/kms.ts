import { resolveInstanceConfig } from '@/lib/config'
import { hasEncryptionKey } from '@/lib/secret-crypto'
import { dataKeyContext } from '@/lib/providers/kms/types'
import { resolverFor } from '@/lib/providers/kms/keyring'
import { decodeSettings } from '../ops/instance-db'
import { createDataKey, hasKmsSchema, kmsProviderForConfig, listDataKeys, rewrapDataKeys } from '../ops/kms'
import { isApiClient, NEEDS_DIRECT_REMEDY, NeedsDirectConnectionError } from '../ops/service-sql'
import type { AreaSwitch, PreflightCheck } from './types'

/**
 * kms: move the data keys to another KMS (env ⇄ vault_transit ⇄ aws_kms ⇄
 * azure_key_vault ⇄ gcp_kms). Stored secrets are not touched: they stay
 * encrypted with the same data keys, which are only re-wrapped.
 *
 *  1. Every data key is unwrapped with the provider that wrapped it and
 *     wrapped again with the target (each round-trip verified, one row at a
 *     time; re-running skips rows already moved).
 *  2. Without any data key yet, one is created under the target, so new
 *     secrets get envelope encryption as soon as the app restarts.
 *
 * Then `usertasks-admin kms rewrap` re-encrypts enc:v1 values (and values of
 * older data keys) under the newest key; after that ENCRYPTION_KEY is no
 * longer needed for data (it still protects the KMS's own credentials in
 * instance settings, if any are stored there). Rollback re-wraps every data
 * key — including one the switch created — with the previous provider, so
 * nothing written meanwhile becomes unreadable.
 *
 * Without a direct connection (the service-role API) only the provider
 * selection runs: allowed while there are no data keys yet (nothing to
 * re-wrap), and the first data key is then left to `usertasks-admin kms
 * rotate` where DATABASE_URL is set — until then secrets keep using
 * ENCRYPTION_KEY, exactly as before the switch.
 */

export const kmsSwitch: AreaSwitch = {
  area: 'kms',
  writesProviderSetting: true,
  supports: () => null,
  async preflight(ctx) {
    const checks: PreflightCheck[] = []
    if (!(await hasKmsSchema(ctx.db))) {
      return [{ name: 'schema', severity: 'error', detail: 'app_kms.data_keys missing: apply migration 20261108100000 (usertasks-admin db migrate)' }]
    }
    let target
    try {
      target = await kmsProviderForConfig(ctx.targetConfig)
      const probe = Buffer.alloc(32, 7)
      const back = await target.unwrap(await target.wrap(probe, dataKeyContext(0)), dataKeyContext(0))
      if (!back.equals(probe)) throw new Error('the KMS returned a different key on unwrap')
      checks.push({ name: 'target', severity: 'ok', detail: `wrapped and unwrapped a probe key with ${target.describe()}` })
    } catch (error) {
      return [{ name: 'target', severity: 'error', detail: (error as Error).message }]
    }
    const current = await kmsProviderForConfig(ctx.config)
    const resolve = resolverFor(current)
    const rows = await listDataKeys(ctx.db)
    const { unwrapDataKey } = await import('@/lib/providers/kms/keyring')
    for (const row of rows) {
      try {
        ;(await unwrapDataKey(row, resolve)).fill(0)
      } catch (error) {
        checks.push({ name: `data key ${row.id}`, severity: 'error', detail: (error as Error).message })
      }
    }
    if (rows.length && isApiClient(ctx.db)) {
      checks.push({ name: 'data keys', severity: 'error', detail: `${rows.length} data key(s) must be re-wrapped with ${ctx.to}, which needs a direct database connection: ${NEEDS_DIRECT_REMEDY}` })
    }
    if (rows.length && !checks.some((c) => c.severity === 'error')) checks.push({ name: 'data keys', severity: 'ok', detail: `${rows.length} data key(s) unwrap with the current configuration` })
    if (!rows.length) {
      checks.push({ name: 'data keys', severity: 'ok', detail: isApiClient(ctx.db)
        ? `none yet: nothing to re-wrap. Create the first one under ${ctx.to} later with usertasks-admin kms rotate --yes where DATABASE_URL is set${hasEncryptionKey() ? ' (until then secrets keep using ENCRYPTION_KEY)' : ''}`
        : `none yet: one will be created under ${ctx.to}${hasEncryptionKey() ? ' (existing enc:v1 secrets keep decrypting with ENCRYPTION_KEY)' : ''}` })
    }
    return checks
  },
  async backup(ctx) {
    ctx.rollbackData.kms = { from: ctx.from, keys: (await listDataKeys(ctx.db)).map((r) => r.id) }
    return []
  },
  steps(ctx) {
    ctx.notes.push('Restart every app instance and worker (data keys created from now on are wrapped by the new KMS). Then re-encrypt the stored secrets under the newest data key: usertasks-admin kms rewrap --yes')
    return [
      {
        id: 'rewrap-keys',
        title: `Re-wrap the data keys with ${ctx.to}`,
        async plan() {
          const rows = await listDataKeys(ctx.db)
          return rows.length ? `re-wrap ${rows.map((r) => `#${r.id}`).join(', ')}` : 'no data keys yet'
        },
        async run() {
          if (isApiClient(ctx.db)) {
            if ((await listDataKeys(ctx.db)).length) throw new NeedsDirectConnectionError('Re-wrapping the data keys')
            return 'no data keys to re-wrap'
          }
          const target = await kmsProviderForConfig(ctx.targetConfig)
          const current = await kmsProviderForConfig(ctx.config)
          const resolveBoth = (id: string) => (id === target.id ? target : resolverFor(current)(id))
          const result = await rewrapDataKeys(ctx.db, target, resolveBoth, { log: ctx.log })
          return `re-wrapped ${result.rewrapped.length}, already on ${target.id} ${result.unchanged.length}`
        },
      },
      {
        id: 'create-data-key',
        title: 'Create the first data key (when there is none)',
        async run() {
          if ((await listDataKeys(ctx.db)).length) return 'data keys exist'
          if (isApiClient(ctx.db)) return 'skipped without a direct connection: run usertasks-admin kms rotate --yes where DATABASE_URL is set'
          const created = await createDataKey(ctx.db, await kmsProviderForConfig(ctx.targetConfig), { activateInSeconds: 0, actor: ctx.options.actor })
          return `created data key #${created.id}`
        },
      },
    ]
  },
  async rollback(ctx) {
    const before = resolveInstanceConfig(decodeSettings(ctx.record.config_before?.settings ?? []))
    const after = resolveInstanceConfig(decodeSettings(ctx.record.config_after?.settings ?? ctx.record.config_before?.settings ?? []))
    const previous = await kmsProviderForConfig(before)
    const switched = await kmsProviderForConfig(after)
    if (ctx.dryRun) return [`would re-wrap every data key with ${previous.describe()}`]
    if (isApiClient(ctx.db)) {
      if ((await listDataKeys(ctx.db)).length) throw new NeedsDirectConnectionError('Re-wrapping the data keys')
      return ['no data keys to re-wrap']
    }
    const resolve = (id: string) => (id === switched.id ? switched : resolverFor(previous)(id))
    const result = await rewrapDataKeys(ctx.db, previous, resolve)
    return [`re-wrapped ${result.rewrapped.length} data key(s) with ${previous.id}`]
  },
}
