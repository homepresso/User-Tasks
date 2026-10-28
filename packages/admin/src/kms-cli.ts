import type { ParsedValues, CliIO } from './cli'
import { defaultActor, type SqlClient } from './instance'
import {
  activationSeconds,
  configuredKms,
  createDataKey,
  hasKmsSchema,
  kmsConfig,
  kmsStatus,
  listDataKeys,
  pruneDataKeys,
  rewrapDataKeys,
  runRewrap,
  unusedDataKeys,
} from './kms'
import { resolverFor } from '@/lib/providers/kms/keyring'
import { describeError } from '@/lib/providers/kms/types'

/** `usertasks-admin kms <action>`; returns the exit code. */
export async function runKms(action: 'status' | 'rotate' | 'rewrap' | 'rewrap-keys' | 'prune', db: SqlClient, values: ParsedValues, io: CliIO): Promise<number> {
  if (!(await hasKmsSchema(db))) {
    io.err('This database has no app_kms schema: apply the migrations first (usertasks-admin db migrate).')
    return 1
  }
  const config = await kmsConfig(db)
  const actor = values.actor || defaultActor()
  const refuse = (what: string) => {
    io.err(`Refusing to ${what} without --yes (or use --dry-run where available).`)
    return 2
  }
  try {
    switch (action) {
      case 'status': {
        const status = await kmsStatus(db, config)
        if (values.json) { io.out(JSON.stringify(status, null, 2)); return 0 }
        io.out(`KMS provider: ${status.provider} (${status.source}) — ${status.kek}`)
        if (!status.keys.length) io.out('Data keys: none — secrets are encrypted with ENCRYPTION_KEY (enc:v1). Create one with `usertasks-admin kms rotate`.')
        else {
          io.out('Data keys:')
          for (const k of status.keys) {
            const when = new Date(k.activatesAt) > new Date() ? `active from ${k.activatesAt}` : k.active ? 'ACTIVE (new values)' : 'decrypt only'
            io.out(`  #${String(k.id).padEnd(4)} ${k.provider.padEnd(16)} ${when.padEnd(36)} ${String(k.values).padStart(6)} value(s)  ${k.loaded ? '' : 'NOT LOADED  '}${k.kekRef}`)
          }
        }
        const totals = new Map<string, number>()
        for (const counts of Object.values(status.ciphertext)) for (const [label, n] of Object.entries(counts)) totals.set(label, (totals.get(label) ?? 0) + n)
        io.out(`Stored secrets: ${totals.size ? [...totals].map(([label, n]) => `${label} ${n}`).join(', ') : 'none'}`)
        for (const r of status.rewraps.slice(0, 3)) io.out(`Rewrap ${r.id}: ${r.status} (target #${r.target}, started ${r.startedAt}${r.finishedAt ? `, finished ${r.finishedAt}` : ''})${r.error ? ` — ${r.error}` : ''}`)
        return 0
      }

      case 'rotate': {
        const provider = await configuredKms(config)
        const seconds = values['activate-in'] !== undefined ? Number(values['activate-in']) : activationSeconds(config)
        io.out(`New data key, wrapped by ${provider.describe()}, active in ${seconds} s.`)
        if (!values.yes) return refuse('create a data key')
        const created = await createDataKey(db, provider, { activateInSeconds: seconds, actor })
        io.out(`Created data key #${created.id} (${created.provider}), active from ${created.activatesAt.toISOString()}.`)
        io.out('Running app instances load it within KMS_REFRESH_SECONDS (default 60). Once it is active, re-encrypt the stored secrets: usertasks-admin kms rewrap --yes')
        return 0
      }

      case 'rewrap': {
        if (!values.yes && !values['dry-run']) return refuse('re-encrypt stored secrets')
        const result = await runRewrap(db, {
          batchSize: values.batch ? Number(values.batch) : undefined, restart: values.restart === true, dryRun: values['dry-run'] === true, actor, log: io.out,
        })
        if (result.status === 'failed') {
          io.err(`Rewrap ${result.runId} stopped: ${result.error}`)
          io.err('Everything before the failure is committed. Fix the cause and run the same command again to resume.')
          return 1
        }
        io.out(result.status === 'dry_run' ? 'Dry run: nothing was changed.' : `Rewrap ${result.runId} completed${result.resumed ? ' (resumed)' : ''}.`)
        return 0
      }

      case 'rewrap-keys': {
        const target = await configuredKms(config)
        const rows = await listDataKeys(db)
        io.out(`Re-wrap ${rows.length} data key(s) with ${target.describe()}${values.force ? ' (all, including those already wrapped by it)' : ''}.`)
        if (!values.yes && !values['dry-run']) return refuse('re-wrap data keys')
        const result = await rewrapDataKeys(db, target, resolverFor(target), { force: values.force === true, dryRun: values['dry-run'] === true, log: io.out })
        io.out(`${values['dry-run'] ? 'Would re-wrap' : 'Re-wrapped'}: ${result.rewrapped.join(', ') || 'none'}; already wrapped by ${target.id}: ${result.unchanged.join(', ') || 'none'}.`)
        return 0
      }

      case 'prune': {
        const unused = await unusedDataKeys(db)
        io.out(unused.length ? `Data keys no stored secret uses: ${unused.map((id) => `#${id}`).join(', ')}` : 'No unused data keys.')
        if (!unused.length || values['dry-run']) return 0
        if (!values.yes) return refuse('delete data keys')
        await pruneDataKeys(db, unused)
        io.out(`Deleted ${unused.length} data key(s). Values encrypted with them can no longer be decrypted (there were none when checked).`)
        return 0
      }
    }
  } catch (error) {
    io.err(describeError(error))
    return 1
  }
}
