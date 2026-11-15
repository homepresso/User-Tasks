import {
  EMBED_FRAME_ANCESTORS_ENV, EMBED_FRAME_ANCESTORS_SETTING, embedListEntries, normaliseEmbedList, resolveEmbedPolicy, type EmbedListSource,
} from '@/lib/embedding'
import type { SqlClient } from '@/lib/admin/ops/instance-db'
import { resolveInstanceConfig } from '@/lib/config'
import { decodeSettings, deleteSetting, encodeSetting, notifyConfigChanged, readSettingRows, upsertSettingRow } from './instance'

/**
 * usertasks-admin embed — trusted embedding (lib/embedding.ts): the sites
 * that may show UserTasks' embeddable pages (/embed/…) in a frame or dialog,
 * e.g. a SharePoint farm:
 *
 *   embed show [--json]              effective origins and where they come from
 *   embed allow <origin>...          add to instance.embed_frame_ancestors
 *   embed remove <origin>... | --all
 *
 * EMBED_FRAME_ANCESTORS in the app's environment wins over the setting.
 */

export const EMBED_ACTIONS = ['show', 'allow', 'remove'] as const
export type EmbedAction = (typeof EMBED_ACTIONS)[number]

export interface EmbedIO { out: (line: string) => void; err: (line: string) => void; env: NodeJS.ProcessEnv }

const SOURCE: Record<EmbedListSource, string> = { env: 'environment of this shell', setting: 'instance setting', none: 'not set' }

export async function runEmbedCommand(action: EmbedAction, args: string[], db: SqlClient, io: EmbedIO, values: { json?: boolean; all?: boolean }): Promise<number> {
  let settings = decodeSettings(await readSettingRows(db))
  if (action !== 'show') {
    const current = embedListEntries(settings.get(EMBED_FRAME_ANCESTORS_SETTING))
    let next: string[]
    try {
      if (action === 'allow') {
        next = normaliseEmbedList([...current, ...args])
      } else {
        const remove = new Set(values.all ? current : normaliseEmbedList(args))
        const missing = [...remove].filter((e) => !current.includes(e))
        if (missing.length) io.err(`Not in ${EMBED_FRAME_ANCESTORS_SETTING}: ${missing.join(', ')}`)
        next = current.filter((e) => !remove.has(e))
      }
    } catch (error) {
      io.err((error as Error).message)
      return 2
    }
    if (next.length) await upsertSettingRow(db, encodeSetting(EMBED_FRAME_ANCESTORS_SETTING, next, false), null)
    else await deleteSetting(db, EMBED_FRAME_ANCESTORS_SETTING)
    const warning = await notifyConfigChanged(db, [resolveInstanceConfig(settings)])
    if (warning) io.err(`warning: ${warning}`)
    io.out(`${EMBED_FRAME_ANCESTORS_SETTING} = ${next.length ? next.join(', ') : '(none)'}`)
    if (io.env[EMBED_FRAME_ANCESTORS_ENV]?.trim()) io.err(`warning: ${EMBED_FRAME_ANCESTORS_ENV} is set in this environment and wins over the setting (if the app has it too).`)
    io.out('The app picks the change up within about 30 seconds.')
    settings = decodeSettings(await readSettingRows(db))
  }
  const policy = resolveEmbedPolicy(io.env, settings)
  if (values.json) {
    io.out(JSON.stringify(policy, null, 2))
    return 0
  }
  io.out(`Sites that may frame UserTasks' embeddable pages (${SOURCE[policy.source]}): ${policy.origins.join(', ') || '(none — no framing)'}`)
  if (policy.origins.length) io.out('Session cookies are SameSite=None; Secure when the app runs on https (cross-site requests other than framed embeddable pages and top-level navigations still lose them).')
  for (const problem of policy.invalid) io.err(`ignored entry: ${problem}`)
  return 0
}
