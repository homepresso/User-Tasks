import { resolveInstanceConfig } from '@/lib/config'
import { decodeSettings, encodeSetting, notifyConfigChanged, readSettingRows, tableExists, upsertSettingRow, type SqlClient } from '@/lib/admin/ops/instance-db'
import { parseAdminEmails } from '@/lib/admin/instance-admins'
import type { ConfigSetting } from './profile'

/**
 * `usertasks-admin install profile apply`: store a profile's instance
 * settings (placement "settings") in `instance_settings`, after `db migrate`.
 * Credentials are encrypted exactly as `usertasks-admin switch --secret` does
 * (lib/admin/ops/instance-db encodeSetting).
 *
 * Settings that already exist are kept unless `overwrite`: re-running an
 * installer (an upgrade, a repair) must not undo changes made since in the
 * setup wizard or Settings → Infrastructure. instance.admin_emails is merged
 * rather than replaced.
 */

export interface ApplyResult {
  written: string[]
  skipped: string[]
  warning: string | null
}

export async function applyProfileSettings(db: SqlClient, settings: ConfigSetting[], opts: { overwrite?: boolean; actor?: string } = {}): Promise<ApplyResult> {
  if (!(await tableExists(db, 'public.instance_settings'))) {
    throw new Error('The instance_settings table does not exist yet: run `usertasks-admin db migrate` first (nothing was changed).')
  }
  const beforeRows = await readSettingRows(db)
  const before = decodeSettings(beforeRows)
  // Encode everything first: a credential that can't be encrypted stops the whole apply before anything is written.
  const rows = settings.map((s) => {
    if (s.key === 'instance.admin_emails') {
      const merged = [...new Set([...parseAdminEmails(before.get(s.key)), ...parseAdminEmails(s.value)])]
      return { setting: s, row: encodeSetting(s.key, merged.join(','), false), merge: true }
    }
    return { setting: s, row: encodeSetting(s.key, s.value, s.secret), merge: false }
  })
  const written: string[] = []
  const skipped: string[] = []
  for (const { setting, row, merge } of rows) {
    if (before.has(setting.key) && !opts.overwrite && !merge) { skipped.push(setting.key); continue }
    await upsertSettingRow(db, row, null)
    written.push(setting.key)
  }
  const after = decodeSettings(await readSettingRows(db))
  const warning = written.length ? await notifyConfigChanged(db, [resolveInstanceConfig(before), resolveInstanceConfig(after)]) : null
  return { written, skipped, warning }
}
