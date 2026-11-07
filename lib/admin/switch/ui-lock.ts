import { resolveInstanceConfig } from '@/lib/config'
import { decodeSettings, encodeSetting, envProviderVars, notifyConfigChanged, readSettingRows, upsertSettingRow, type SqlClient } from '../ops/instance-db'
import { ALLOW_UI_SWITCHING_SETTING } from '../switch-runtime'
import { insertRecord, newRecord, newSwitchId, updateRecord } from './log'
import type { SwitchRecordRow } from './types'

/**
 * The cloud lock (instance.allow_ui_switching), changed from Settings →
 * Infrastructure (Unlock / Lock) or `usertasks-admin ui-switching on|off`,
 * over a direct connection or the service-role API. Every change is a
 * `settings` row in the switch log (area `instance`, migration
 * 20261123000000) with who made it and the setting before and after, so it
 * is audited like a provider change and can be rolled back. The audit row is
 * written first: without it, nothing changes.
 */

export interface UiLockResult {
  allowed: boolean
  changed: boolean
  record: SwitchRecordRow | null
  warning: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function uiSwitchingAllowed(value: unknown): boolean {
  return value === true || value === 'true'
}

export async function setUiSwitching(db: SqlClient, allow: boolean, actor: string, options: { userId?: string | null } = {}): Promise<UiLockResult> {
  const before = await readSettingRows(db)
  const was = uiSwitchingAllowed(decodeSettings(before).get(ALLOW_UI_SWITCHING_SETTING))
  if (was === allow) return { allowed: allow, changed: false, record: null, warning: null }
  const label = (on: boolean) => (on ? 'unlocked' : 'locked')
  const record = newRecord({
    id: newSwitchId(), kind: 'settings', area: 'instance', from_provider: label(was), to_provider: label(allow), actor, backup_dir: null,
    steps: [{ id: 'config', title: allow ? 'Unlock provider changes from the page' : 'Lock provider changes from the page', status: 'running', started_at: new Date().toISOString() }],
    config_before: { settings: before, env: envProviderVars() },
  })
  record.log = [`${ALLOW_UI_SWITCHING_SETTING} = ${allow} (was ${was}) by ${actor}`]
  try {
    await insertRecord(db, record)
  } catch (error) {
    const message = (error as Error).message
    throw new Error(/area_check|violates check constraint/i.test(message)
      ? 'The switch log cannot record this change yet: apply migration 20261123000000_infra_switch_lease first (nothing was changed).'
      : `The switch log cannot record this change (nothing was changed): ${message}`)
  }
  try {
    await upsertSettingRow(db, encodeSetting(ALLOW_UI_SWITCHING_SETTING, allow, false), options.userId && UUID.test(options.userId) ? options.userId : null)
    record.steps[0] = { ...record.steps[0], status: 'done', finished_at: new Date().toISOString(), detail: `${ALLOW_UI_SWITCHING_SETTING} = ${allow}` }
    record.status = 'succeeded'
  } catch (error) {
    record.steps[0] = { ...record.steps[0], status: 'failed', finished_at: new Date().toISOString(), detail: (error as Error).message }
    record.status = 'failed'
    record.error = (error as Error).message
  }
  const after = await readSettingRows(db)
  record.config_after = { settings: after, env: envProviderVars() }
  record.finished_at = new Date().toISOString()
  await updateRecord(db, record)
  if (record.status === 'failed') throw new Error(`Could not change ${ALLOW_UI_SWITCHING_SETTING}: ${record.error}`)
  const warning = await notifyConfigChanged(db, [resolveInstanceConfig(decodeSettings(after))])
  return { allowed: allow, changed: true, record, warning }
}
