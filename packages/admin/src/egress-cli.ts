import {
  ALLOW_PRIVATE_EGRESS_ENV, EGRESS_HTTP_ALLOW_ENV, EGRESS_HTTP_ALLOW_SETTING, EGRESS_PRIVATE_ALLOW_ENV, EGRESS_PRIVATE_ALLOW_SETTING,
  egressListEntries, normaliseEgressList, resolveEgressPolicy, summariseEgressPolicy, type EgressListSource,
} from '@/lib/egress-policy'
import type { SqlClient } from '@/lib/admin/ops/instance-db'
import { resolveInstanceConfig } from '@/lib/config'
import { decodeSettings, deleteSetting, encodeSetting, notifyConfigChanged, readSettingRows, upsertSettingRow } from './instance'

/**
 * usertasks-admin egress — the on-premises network policy for connectors
 * (lib/egress-policy.ts), self-hosted only:
 *
 *   egress show [--json]                      effective lists and where they come from
 *   egress allow-private <host|*.domain|CIDR>...   add to instance.egress_private_allow
 *   egress remove-private <entry>... | --all
 *   egress allow-http <host|*.domain|CIDR>...      add to instance.egress_http_allow
 *   egress remove-http <entry>... | --all
 *
 * EGRESS_PRIVATE_ALLOW / EGRESS_HTTP_ALLOW in the app's environment win over
 * the settings; the cloud edition ignores both.
 */

export const EGRESS_ACTIONS = ['show', 'allow-private', 'remove-private', 'allow-http', 'remove-http'] as const
export type EgressAction = (typeof EGRESS_ACTIONS)[number]

export interface EgressIO { out: (line: string) => void; err: (line: string) => void; env: NodeJS.ProcessEnv }

const SOURCE: Record<EgressListSource, string> = { env: 'environment of this shell', setting: 'instance setting', none: 'not set' }

function listOf(settings: Map<string, unknown>, key: string): string[] {
  return egressListEntries(settings.get(key))
}

export async function runEgressCommand(action: EgressAction, args: string[], db: SqlClient, io: EgressIO, values: { json?: boolean; all?: boolean; actor?: string }): Promise<number> {
  const rows = await readSettingRows(db)
  let settings = decodeSettings(rows)

  if (action !== 'show') {
    const key = action.endsWith('private') ? EGRESS_PRIVATE_ALLOW_SETTING : EGRESS_HTTP_ALLOW_SETTING
    const envName = action.endsWith('private') ? EGRESS_PRIVATE_ALLOW_ENV : EGRESS_HTTP_ALLOW_ENV
    const current = listOf(settings, key)
    let next: string[]
    try {
      if (action.startsWith('allow')) {
        next = normaliseEgressList([...current, ...args])
      } else {
        const remove = new Set(values.all ? current : normaliseEgressList(args))
        const missing = [...remove].filter((e) => !current.includes(e))
        if (missing.length) io.err(`Not in ${key}: ${missing.join(', ')}`)
        next = current.filter((e) => !remove.has(e))
      }
    } catch (error) {
      io.err((error as Error).message)
      return 2
    }
    if (next.length) await upsertSettingRow(db, encodeSetting(key, next, false), null)
    else await deleteSetting(db, key)
    const warning = await notifyConfigChanged(db, [resolveInstanceConfig(settings)])
    if (warning) io.err(`warning: ${warning}`)
    io.out(`${key} = ${next.length ? next.join(', ') : '(none)'}`)
    if (io.env[envName]?.trim()) io.err(`warning: ${envName} is set in this environment and wins over the setting (if the app has it too).`)
    if (io.env.DEPLOYMENT_MODE?.trim().toLowerCase() === 'cloud') io.err('warning: DEPLOYMENT_MODE=cloud — the cloud edition ignores this setting.')
    io.out('The app picks the change up within about 30 seconds.')
    settings = decodeSettings(await readSettingRows(db))
  }

  const policy = resolveEgressPolicy(io.env, settings)
  const summary = summariseEgressPolicy(policy)
  if (values.json) {
    io.out(JSON.stringify(summary, null, 2))
    return 0
  }
  io.out(`Edition: ${summary.mode === 'cloud' ? 'cloud (private networks and plain http are never allowed)' : 'self-hosted'}`)
  io.out(`Private network allowlist (${SOURCE[summary.privateSource]}): ${summary.privateAllow.join(', ') || '(none)'}`)
  io.out(`Plain http allowed for (${SOURCE[summary.httpSource]}): ${summary.httpAllow.join(', ') || '(none — https required)'}`)
  if (summary.ignoredInCloud) io.out('  (listed, but ignored in the cloud edition)')
  if (summary.allowAllPrivate) io.out(`${ALLOW_PRIVATE_EGRESS_ENV}=true: every private range is open (broad — prefer the allowlist). Cloud metadata stays blocked.`)
  for (const problem of summary.invalid) io.err(`ignored entry: ${problem}`)
  io.out('Cloud metadata endpoints (169.254.169.254, fd00:ec2::254, …) are always blocked.')
  return 0
}
